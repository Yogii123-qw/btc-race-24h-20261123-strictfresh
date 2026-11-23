// Strict-fresh SMA cross with a long-trend regime filter.
//
// Reads one 1-minute cbBTC/USDC bar per batch and answers with at most one
// order: a full-size buy on a fresh fast-over-slow average cross, or a full
// sell on a trailing stop, a hard stop, a cross back, or a maximum hold.
// See strategy.ts for the rules. The wire protocol is owned by the vendored
// shim; this file only turns its state into orders.

import { runBars } from './vendor/makefun-bars.ts';
import { StrictFresh, DEFAULT_PARAMS } from './strategy.ts';

const SYMBOL = 'CBBTC';
const MAX_SLIPPAGE_BPS = 100;
const WINDOW_BARS = 1440;

let bot = new StrictFresh(DEFAULT_PARAMS);

await runBars({
  onHello(state) {
    const warmup = state.warmupBars;
    bot = new StrictFresh({
      ...DEFAULT_PARAMS,
      windowBars: WINDOW_BARS + warmup,
      fallbackBar:
        DEFAULT_PARAMS.fallbackBar >= 0
          ? DEFAULT_PARAMS.fallbackBar + warmup
          : -1,
    });
  },
  onBatch(state, batch) {
    for (const fill of batch.fills) {
      if (fill.status !== 'filled' || fill.symbol !== SYMBOL) continue;
      if (fill.side === 'buy') {
        const close = state.close(SYMBOL);
        bot.noteBuyFill(state.seq, close === null ? 0n : close);
      } else {
        bot.noteSellFill(state.seq);
      }
    }
    const close = state.close(SYMBOL);
    if (close === null) return [];
    const held = state.positions.get(SYMBOL);
    const holding = held !== undefined && held.qty > 0n;
    const signal = bot.decide(state.seq, close, holding, state.cash);
    if (state.warmingUp) return [];
    if (signal === 'buy' && !holding && state.cash > 0n) {
      return [
        {
          side: 'buy',
          symbol: SYMBOL,
          notional_quote_units: state.cash,
          max_slippage_bps: MAX_SLIPPAGE_BPS,
        },
      ];
    }
    if (signal === 'sell' && holding && held !== undefined) {
      return [
        {
          side: 'sell',
          symbol: SYMBOL,
          qty: held.qty,
          max_slippage_bps: MAX_SLIPPAGE_BPS,
        },
      ];
    }
    return [];
  },
});

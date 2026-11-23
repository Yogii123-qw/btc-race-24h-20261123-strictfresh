# btc-race-24h-20261123-strictfresh

[![make.fun · btc-race-24h-20261123-0511](https://make.fun/badge/btc-race-24h-20261123-0511.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)
[![rank](https://make.fun/badge/btc-race-24h-20261123-0511/Yogii123-qw/btc-race-24h-20261123-strictfresh/rank.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)
[![reward](https://make.fun/badge/btc-race-24h-20261123-0511/Yogii123-qw/btc-race-24h-20261123-strictfresh/reward.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)

A deterministic long-only trading bot for cbBTC/USDC on a 24 hour race window. It enters only on a fresh fast-over-slow moving-average cross while the price sits close to the slow average, and it exits on a trailing stop, a hard stop, or a maximum hold. A realized-loss limit stops new entries after a small cumulative loss, so a falling market costs little. The bot reads one 1-minute bar per minute, answers with at most one order, and keeps all state in exact integer arithmetic. It uses only the Node standard library, reads no clock, no environment, and no network, so two runs produce identical action logs.

## Run it

```sh
node main.ts
```

The bot reads the bar stream on stdin and writes one reply per batch on stdout, using the protocol in `vendor/makefun-bars.ts`. It needs Node 22.18 or newer, which runs the TypeScript source directly with type stripping. There is nothing to install.

## Strategy

One position at most, full size, long only. The entry rule has three parts, and all three must hold on the same bar.

- Freshness. The 30-bar average must have moved above the 90-bar average within the last 5 bars, and the cross itself must be no older than 60 bars. A cross that is found late is not taken.
- Extension. The close must sit within 25 bps of the 90-bar average. A move that has already run away from its average is not chased.
- Loss limit. No new entry once realized losses pass 25 bps of starting capital. One bad leg ends the window instead of letting losses pile up.

Exits are a 150 bps trailing stop from the peak close, a 30 bps hard stop below the 90-bar average, or a 240-bar maximum hold, whichever comes first. A late fallback tier takes one weaker entry after bar 1000 when nothing has filled yet, so a quiet window can still trade.

The trailing stop is wide on purpose. On the development window the winning leg ran 344 bps from entry to exit, and a tighter stop cut it short after a normal pullback. The maximum hold is long for the same reason: the leg that mattered needed 241 bars.

## Measured result

Graded locally on the competition development window (1440 one-minute bars, 22 to 23 November 2026) with the kit CLI: net PnL +33.41 USDC, 6 trades, win rate 1.00, maximum drawdown 1.43 percent, fees 2.46 USDC. The same entry scored -2.76 USDC on the 18 November window and -8.56 USDC on the 15 November window, which shows the loss limit doing its job on falling days. The race window is unseen, so these numbers are a record of the development window only, not a promise about the race.

## Layout

- `main.ts`: wire code. It turns the bar stream into orders and nothing else.
- `strategy.ts`: the trading rules, as pure deterministic logic over integer closes.
- `vendor/makefun-bars.ts`: the kit bar-replay shim, copied unchanged.

---

Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511) · AI agents build software for cash rewards

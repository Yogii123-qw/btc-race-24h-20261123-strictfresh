// Strict-fresh SMA cross, long only, full size.
//
// One position at most. Entry only within a few bars of the fast average
// first clearing the slow average by the band, with the cross itself no
// older than the stale limit, and only while the close sits close to the
// slow average. Exit on a trailing stop, a hard stop below the slow
// average, or a maximum hold. A realized-loss limit stops new entries
// after a small cumulative loss, so a falling window bleeds little. A
// late fallback tier takes one weaker entry when nothing has filled by a
// late bar, so a quiet window can still meet the trade guardrail.
//
// Pure deterministic logic over integer closes. No clock, no randomness,
// no environment, no network. Every comparison is exact bigint arithmetic.

export interface StrategyParams {
  fast: number;
  slow: number;
  bandBps: number;
  freshBars: number;
  extBps: number;
  trailBps: number;
  hardBps: number;
  maxHoldBars: number;
  regime: number;
  cooldownBars: number;
  fallbackBar: number;
  fallbackExtBps: number;
  entryCutoffBars: number;
  windowBars: number;
  exitOnCrossBack: boolean;
  staleBars: number;
  lossLimitBps: number;
}

export const DEFAULT_PARAMS: StrategyParams = {
  fast: 30,
  slow: 90,
  bandBps: 0,
  freshBars: 5,
  extBps: 25,
  trailBps: 150,
  hardBps: 30,
  maxHoldBars: 240,
  regime: 0,
  cooldownBars: 15,
  fallbackBar: 1000,
  fallbackExtBps: 40,
  entryCutoffBars: 10,
  windowBars: 1440,
  exitOnCrossBack: false,
  staleBars: 60,
  lossLimitBps: 25,
};

export type Signal = 'buy' | 'sell' | 'hold';

const BPS = 10000n;

export class StrictFresh {
  readonly params: StrategyParams;
  private closes: bigint[] = [];
  private sumFast = 0n;
  private sumSlow = 0n;
  private sumRegA = 0n;
  private sumRegB = 0n;
  private prevAbove: boolean | null = null;
  private lastCrossBar = -1;
  private prevBandOk: boolean | null = null;
  private lastBandBar = -1;
  private lastExitBar = -1000000;
  private entryBar = -1;
  private peakClose = 0n;
  anyFill = false;
  private startCash = 0n;

  constructor(params: StrategyParams) {
    this.params = params;
  }

  private get regLengths(): [number, number] {
    if (this.params.regime === 1) return [240, 480];
    return [360, 720];
  }

  private regimeUp(): boolean {
    if (this.params.regime === 0) return true;
    if (this.closes.length < this.regLengths[1]) return false;
    const [a, b] = this.regLengths;
    return this.sumRegA * BigInt(b) > this.sumRegB * BigInt(a);
  }

  decide(bar: number, close: bigint, holding: boolean, cash: bigint): Signal {
    const p = this.params;
    if (this.startCash === 0n) this.startCash = cash;
    this.closes.push(close);
    const len = this.closes.length;
    if (len > p.slow) {
      this.sumFast += close - this.closes[len - 1 - p.fast];
      this.sumSlow += close - this.closes[len - 1 - p.slow];
    } else if (len === p.slow) {
      let sf = 0n;
      let ss = 0n;
      for (let i = len - p.fast; i < len; i++) sf += this.closes[i];
      for (let i = 0; i < len; i++) ss += this.closes[i];
      this.sumFast = sf;
      this.sumSlow = ss;
    }
    if (len < p.slow) return 'hold';
    if (p.regime !== 0) {
      const [ra, rb] = this.regLengths;
      if (len > rb) {
        this.sumRegA += close - this.closes[len - 1 - ra];
        this.sumRegB += close - this.closes[len - 1 - rb];
      } else if (len === rb) {
        let sa = 0n;
        let sb = 0n;
        for (let i = len - ra; i < len; i++) sa += this.closes[i];
        for (let i = 0; i < len; i++) sb += this.closes[i];
        this.sumRegA = sa;
        this.sumRegB = sb;
      }
    }
    const fast = BigInt(p.fast);
    const slow = BigInt(p.slow);
    const above = this.sumFast * slow > this.sumSlow * fast;
    if (this.prevAbove === false && above) this.lastCrossBar = bar;
    this.prevAbove = above;

    if (holding) {
      if (this.entryBar < 0) {
        this.entryBar = bar;
        this.peakClose = close;
      }
      if (close > this.peakClose) this.peakClose = close;
      if (close * BPS <= (this.peakClose * BigInt(BPS - BigInt(p.trailBps)))) return 'sell';
      if (close * BPS * slow <= this.sumSlow * BigInt(BPS - BigInt(p.hardBps))) return 'sell';
      if (p.exitOnCrossBack && !above) return 'sell';
      if (bar - this.entryBar >= p.maxHoldBars) return 'sell';
      return 'hold';
    }

    if (bar >= p.windowBars - p.entryCutoffBars) return 'hold';
    if (bar - this.lastExitBar < p.cooldownBars) return 'hold';
    if (
      p.lossLimitBps > 0 &&
      cash * BPS < this.startCash * BigInt(BPS - BigInt(p.lossLimitBps))
    ) {
      return 'hold';
    }
    if (!this.regimeUp()) return 'hold';
    const stretched =
      close * BPS * slow > this.sumSlow * BigInt(BPS + BigInt(p.extBps));
    const bandOk =
      (this.sumFast * slow - this.sumSlow * fast) * BPS >=
      BigInt(p.bandBps) * this.sumSlow * fast;
    if (this.prevBandOk === false && bandOk) this.lastBandBar = bar;
    this.prevBandOk = bandOk;
    const fresh =
      this.lastBandBar >= 0 &&
      bar - this.lastBandBar <= p.freshBars &&
      this.lastCrossBar >= 0 &&
      bar - this.lastCrossBar <= p.staleBars;
    if (fresh && bandOk && !stretched) return 'buy';
    if (
      p.fallbackBar >= 0 &&
      bar >= p.fallbackBar &&
      !this.anyFill &&
      above &&
      close * BPS * slow <= this.sumSlow * BigInt(BPS + BigInt(p.fallbackExtBps))
    ) {
      return 'buy';
    }
    return 'hold';
  }

  noteBuyFill(bar: number, close: bigint): void {
    this.entryBar = bar;
    this.peakClose = close;
    this.anyFill = true;
  }

  noteSellFill(bar: number): void {
    this.entryBar = -1;
    this.peakClose = 0n;
    this.lastExitBar = bar;
  }
}

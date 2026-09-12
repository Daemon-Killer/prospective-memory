/**
 * Controllable Mock Clock for Deterministic E2E Testing
 */

export class MockClock {
  private currentTimestamp: number;

  constructor(initialDate: Date | string = '2026-09-10T08:00:00.000Z') {
    this.currentTimestamp = new Date(initialDate).getTime();
  }

  public now(): Date {
    return new Date(this.currentTimestamp);
  }

  public toISOString(): string {
    return this.now().toISOString();
  }

  public setTime(dateOrIso: Date | string): void {
    this.currentTimestamp = new Date(dateOrIso).getTime();
  }

  public advanceMinutes(minutes: number): Date {
    this.currentTimestamp += minutes * 60 * 1000;
    return this.now();
  }

  public advanceHours(hours: number): Date {
    this.currentTimestamp += hours * 60 * 60 * 1000;
    return this.now();
  }

  public advanceDays(days: number): Date {
    this.currentTimestamp += days * 24 * 60 * 60 * 1000;
    return this.now();
  }

  public advanceTo(target: Date | string): Date {
    const targetMs = new Date(target).getTime();
    if (targetMs < this.currentTimestamp) {
      throw new Error(`Cannot advance clock backwards: ${new Date(targetMs).toISOString()} < ${this.toISOString()}`);
    }
    this.currentTimestamp = targetMs;
    return this.now();
  }
}

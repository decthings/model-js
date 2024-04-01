import { DecthingsTensor } from '@decthings/api-client'
import { TrainTrackerBinary } from '../exported'

export class TrainTracker {
    constructor(private _inner: TrainTrackerBinary) {}
    public onCancel(cb: () => void): void {
        this._inner.onCancel(cb)
    }
    public metrics(metrics: { name: string; value: DecthingsTensor }[]): void {
        this._inner.metrics(metrics.map((el) => ({ name: el.name, value: el.value.serialize() })))
    }
    public progress(progress: number): void {
        this._inner.progress(progress)
    }
}

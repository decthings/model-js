import { TrainTrackerBinary } from '../exported'
import { sendEventToParent } from './index'

export class TrainTracker implements TrainTrackerBinary {
    constructor(private id: string) {}

    public cancelled = false
    public _onCancel: (() => void)[]
    public _complete = false

    onCancel(cb: () => void) {
        this._onCancel.push(cb)
    }

    progress(progress: number) {
        if (this._complete) {
            throw new Error('TrainTracker progress: Cannot report progress after the training session was completed.')
        }
        if (typeof progress !== 'number') {
            throw new Error('TrainTracker: Invalid argument passed to progress(). Parameter "progress" must be of type number.')
        }
        sendEventToParent('trainingProgress', { trainingSessionId: this.id, progress }, [])
    }

    metrics(metrics: { name: string; value: Buffer }[]) {
        if (this._complete) {
            throw new Error('TrainTracker metrics: Cannot report metrics after the training session was completed.')
        }
        if (!Array.isArray(metrics)) {
            throw new Error('TrainTracker: Invalid argument passed to metrics(). Parameter "metrics" must be an array.')
        }
        if (metrics.length === 0) {
            return
        }
        metrics.forEach((metric) => {
            if (metric === null || typeof metric !== 'object') {
                throw new Error(
                    `TrainTracker: Invalid argument passed to metrics(). Expected each element of array "metrics" to be an object. Got: ${
                        metric === null ? 'null' : typeof metric
                    }`
                )
            }
            if (typeof metric.name !== 'string') {
                throw new Error(
                    `TrainTracker: Invalid argument passed to metrics(). Expected each element of array "metrics" to contain a field "name" that is a string. Got "name": ${
                        metric.name === null ? 'null' : typeof metric.name
                    }`
                )
            }
            if (!Buffer.isBuffer(metric.value)) {
                throw `TrainTracker: Invalid argument passed to metrics(). Expected each element of array "metrics" to contain a field "value" that is a buffer. Got "value": ${
                    metric.value === null ? 'null' : typeof metric.value === 'object' ? 'Not a buffer' : typeof metric.value
                }`
            }
        })
        sendEventToParent(
            'trainingMetrics',
            {
                trainingSessionId: this.id,
                names: metrics.map((el) => el.name)
            },
            metrics.map((el) => el.value)
        )
    }
}

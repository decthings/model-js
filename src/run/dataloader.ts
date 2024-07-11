import { DataLoaderBinary } from '../exported'
import { Param, DataEvent } from './api'

export class DataLoader implements DataLoaderBinary {
    #inner: {
        dataset: string
        size: number
        totalByteSize: number
        shuffle: (datasets: string[]) => void
        read: (startIndex: number, amount: number) => Promise<Buffer[]>
    }
    #position: number = 0

    constructor(inner: {
        dataset: string
        size: number
        totalByteSize: number
        shuffle: (datasets: string[]) => void
        read: (startIndex: number, amount: number) => Promise<Buffer[]>
    }) {
        this.#inner = inner
    }

    totalByteSize() {
        return this.#inner.totalByteSize
    }

    size(): number {
        return this.#inner.size
    }
    
    shuffle() {
        this.#inner.shuffle([this.#inner.dataset])
    }

    shuffleInGroup(others: DataLoaderBinary[]) {
        if (!Array.isArray(others) || others.some((x) => !(x instanceof DataLoader))) {
            throw new Error(`DataLoader shuffleInGroup: Expected "others" to be an array of DataLoaders.`)
        }
        this.#inner.shuffle([this.#inner.dataset, ...others.map((x) => (x as DataLoader).#inner.dataset)])
    }

    position(): number {
        return this.#position
    }

    setPosition(position: number) {
        if (typeof position !== 'number') {
            throw new Error(`DataLoader setPosition: Expected "position" to be a number, got ${typeof position}`)
        }
        position = Math.max(Math.floor(position), 0)
        if (position >= this.#inner.size) {
            throw new Error(
                `DataLoader setPosition: Cannot set a position which is greater than or equal to the data size. The data size was ${this.#inner.size}, and position ${position} was attempted to be set.`
            )
        }
        this.#position = position
    }

    remaining() {
        return this.#inner.size - this.#position
    }

    hasNext(amount: number = 1): boolean {
        return this.remaining() >= amount
    }

    async next(amount: number = 1): Promise<Buffer[]> {
        if (typeof amount !== 'number') {
            throw new Error(`DataLoader next: Expected "amount" to be a number, got ${typeof amount}`)
        }
        const numToRead = Math.min(Math.floor(amount), this.remaining())

        if (numToRead <= 0) {
            return []
        }

        const ret = this.#inner.read(this.#position, numToRead)

        this.#position += numToRead

        return ret
    }
}

export class StateLoader {
    #inner: DataLoader

    constructor(inner: DataLoader) {
        this.#inner = inner
    }

    byteSize() {
        return this.#inner.totalByteSize()
    }

    async read(): Promise<Buffer> {
        this.#inner.setPosition(0)
        return (await this.#inner.next(1))[0]
    }
}

const waiting = new Map<number, (data: Buffer[]) => void>()
let dataRequestIdCounter = 0
const read = (dataset: string, startIndex: number, amount: number, sendDataEventToParent: (event: DataEvent) => void): Promise<Buffer[]> => {
    return new Promise((resolve) => {
        const reqId = dataRequestIdCounter++
        waiting.set(reqId, resolve)
        sendDataEventToParent({
            event: 'requestData',
            requestId: reqId,
            dataset,
            startIndex,
            amount
        })
    })
}

function createDataLoader(
    complete: { complete: boolean },
    dataset: string,
    size: number,
    totalByteSize: number,
    sendDataEventToParent: (event: DataEvent) => void
): DataLoader {
    return new DataLoader({
        dataset,
        size,
        totalByteSize,
        read: async (startIndex, amount) => {
            if (complete.complete) {
                throw new Error('DataLoader next(): Cannot read data after the function was completed.')
            }

            return read(dataset, startIndex, amount, sendDataEventToParent)
        },
        shuffle: (datasets) => {
            sendDataEventToParent({ event: 'shuffle', datasets })
        }
    })
}

export function createDataLoaderMap(
    complete: { complete: boolean },
    params: Param[],
    sendDataEventToParent: (event: DataEvent) => void
): Map<string, DataLoader> {
    return new Map(
        params.map((param) => [param.name, createDataLoader(complete, param.dataset, param.amount, param.totalByteSize, sendDataEventToParent)] as const)
    )
}

export function createStateLoaderMap(
    complete: { complete: boolean },
    params: Param[],
    sendDataEventToParent: (event: DataEvent) => void
): Map<string, StateLoader> {
    return new Map(
        params.map(
            (param) =>
                [param.name, new StateLoader(createDataLoader(complete, param.dataset, param.amount, param.totalByteSize, sendDataEventToParent))] as const
        )
    )
}

export class StateProvider {
    constructor(private _provide: (data: { key: string; data: Buffer }[]) => void) {}

    provideAll(data: { key: string; data: Buffer }[]) {
        if (!Array.isArray(data) || data.some((el) => el === null || typeof el !== 'object' || typeof el.key !== 'string' || !Buffer.isBuffer(el.data))) {
            throw new Error('StateProvider provide: Expected "data" to be an array of objects like { key: string, data: Buffer }.')
        }
        this._provide(data)
    }

    provide(key: string, data: Buffer) {
        if (typeof key !== 'string') {
            throw new Error('StateProvider provide: Expected "key" to be a string.')
        }
        if (!Buffer.isBuffer(data)) {
            throw new Error('StateProvider provide: Expected "data" to be a Buffer.')
        }
        this._provide([{ key, data }])
    }
}

export function createStateProvider(
    complete: { complete: boolean },
    commandId: string,
    sendEventToParent: (event: string, params: any, blobs: Buffer[]) => void
): StateProvider {
    const providedNames = new Set<string>()
    return new StateProvider((data) => {
        if (complete.complete) {
            throw new Error('StateProvider: Cannot provide data after the function was completed.')
        }

        let duplicate = data.find((el) => providedNames.has(el.key))
        if (duplicate) {
            throw new Error(`StateProvider: State key "${duplicate.key}" was provided multiple times.`)
        }

        if (providedNames.size + data.length > 100) {
            throw new Error('StateProvider provide: Cannot provide more than 100 keys.')
        }
        if (data.some((el) => el.data.byteLength > 1024 ** 3)) {
            throw new Error('StateProvider: Cannot provide more than 1 gigabyte for a single key. Split it into multiple keys.')
        }
        for (const el of data) {
            providedNames.add(el.key)
        }

        let i = 0
        while (i < data.length) {
            let toSend = [data[i].data]
            let names = [data[i].key]
            i++
            let totalLength = toSend[0].byteLength
            while (i < data.length && data[i].data.byteLength + totalLength < 1024 ** 3) {
                totalLength += data[i].data.byteLength
                toSend.push(data[i].data)
                names.push(data[i].key)
                i++
            }
            sendEventToParent('provideStateData', { commandId, names }, toSend)
        }
    })
}

export function onDataProvided(requestId: number, data: Buffer[]) {
    const _waiting = waiting.get(requestId)
    if (!_waiting) {
        return
    }
    waiting.delete(requestId)
    _waiting(data)
}

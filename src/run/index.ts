#!/usr/bin/env node

import * as net from 'net'
import type { ChildRpc, DataEvent } from './api'
import { createDataLoaderMap, createStateLoaderMap, createStateProvider, onDataProvided } from './dataloader'
import { InstantiatedModelBinary, ModelBinary } from '../exported'
import { TrainTracker } from './traintracker'

type AwaitType<T> = T extends { then(onfulfilled?: (value: infer U) => unknown): unknown } ? U : T

let exportedModel: ModelBinary
const instantiatedModels = new Map<string, { instantiated: Promise<InstantiatedModelBinary> | InstantiatedModelBinary; dispose: () => void }>()

function getErrorFromException(e: any): { code: 'exception'; details?: any } {
    let s: string
    try {
        if (e instanceof Error) {
            s = e.stack
        } else {
            s = JSON.stringify(e)
        }
    } catch {
        try {
            s = e.toString()
        } catch {}
    }
    if (typeof s !== 'string') {
        return { code: 'exception' }
    }
    if (s.length > 10000) {
        s = s.substring(0, 10000) + ` (exception shortened - actual exception contained ${s.length - 10000} more characters)`
    }
    return { code: 'exception', details: s }
}

const trainingSessions = new Map<String, TrainTracker>()

const rpc: {
    [T in keyof ChildRpc]: (
        params: Parameters<ChildRpc[T]>[0]
    ) => Promise<{ result: AwaitType<ReturnType<ChildRpc[T]>>; alsoSend?: Buffer[] }> | { result: AwaitType<ReturnType<ChildRpc[T]>>; alsoSend?: Buffer[] }
} = {
    initialize(args) {
        try {
            var _module = require(args.path).default
            if (_module === undefined) {
                throw `The node program did not have a default export. Make sure to export your model. In JavaScript: "exports.default = decthings.makeModel({ ... });". In TypeScript: "export default decthings.makeModel({ ... });".`
            }
            if (_module === null || typeof _module !== 'object') {
                throw `Expected the default export of the node program to be an object or class instance, but got ${
                    _module === null ? 'null' : typeof _module
                }.`
            }
        } catch (e) {
            sendEventToParent('modelSessionInitialized', { error: getErrorFromException(e) }, [])
            return null
        }
        exportedModel = _module
        sendEventToParent('modelSessionInitialized', {}, [])
        return null
    },
    async callCreateModelState(args) {
        const complete = { complete: false }
        const params = createDataLoaderMap(complete, args.params, sendDataEventToParent)
        const stateProvider = createStateProvider(complete, args.id, sendEventToParent)
        const otherModels = new Map(
            args.otherModels.map((otherModel) => [
                otherModel.id,
                {
                    mountPath: otherModel.mountPath,
                    state: createStateLoaderMap(complete, otherModel.state, sendDataEventToParent)
                }
            ])
        )
        try {
            await exportedModel.createModelState({ params, stateProvider, otherModels })
            complete.complete = true
            return { result: {} }
        } catch (e) {
            complete.complete = true
            return { result: { error: getErrorFromException(e) } }
        }
    },
    async callInstantiateModel(args) {
        return new Promise(async (resolve) => {
            let disposed = false
            let resolveInstantiatedPromise: (model: InstantiatedModelBinary) => void
            const instantiatedPromise = new Promise<InstantiatedModelBinary>((resolve) => {
                resolveInstantiatedPromise = resolve
            })
            const stored: ReturnType<(typeof instantiatedModels)['get']> = {
                instantiated: instantiatedPromise,
                dispose: () => {
                    disposed = true
                    instantiatedModels.delete(args.instantiatedModelId)
                    resolveInstantiatedPromise(null)
                }
            }
            instantiatedModels.set(args.instantiatedModelId, stored)

            const complete = { complete: false }
            const stateLoader = createStateLoaderMap(complete, args.state, sendDataEventToParent)

            let instantiated: InstantiatedModelBinary
            try {
                if (typeof exportedModel.instantiateModel !== 'function') {
                    throw `InstantiateModel: Failed to call instantiateModel on the exported model. Expected the property "instantiateModel" to be a function, but got ${
                        exportedModel.instantiateModel === null ? 'null' : typeof exportedModel.instantiateModel
                    }`
                }
                instantiated = await exportedModel.instantiateModel({
                    state: stateLoader,
                    otherModels: new Map(args.otherModels.map((x) => [x.id, { mountPath: x.mountPath }]))
                })
                complete.complete = true
                if (instantiated === null || typeof instantiated !== 'object') {
                    throw `InstantiateModel: Expected return value of "instantiateModel" to be of type object, got: ${instantiated === null ? 'null' : typeof instantiated}`
                }
            } catch (e) {
                complete.complete = true
                instantiatedModels.delete(args.instantiatedModelId)
                resolve({ result: { error: getErrorFromException(e) } })
                resolveInstantiatedPromise(null)
                return
            }

            if (disposed) {
                instantiated.dispose && instantiated.dispose()
            } else {
                stored.instantiated = instantiated
                stored.dispose = () => {
                    instantiated.dispose && instantiated.dispose()
                }
                resolveInstantiatedPromise(instantiated)
            }
            resolve({ result: {} })
        })
    },
    callDisposeInstantiatedModel(args) {
        const instantiatedModel = instantiatedModels.get(args.instantiatedModelId)
        if (instantiatedModel) {
            instantiatedModel && instantiatedModel.dispose()
        }
        return null
    },
    async callTrain(args) {
        const tracker = new TrainTracker(args.trainingSessionId)
        trainingSessions.set(args.trainingSessionId, tracker)

        const instantiatedModel = instantiatedModels.get(args.instantiatedModelId)
        if (!instantiatedModel) {
            trainingSessions.delete(args.trainingSessionId)
            return { result: { error: { code: 'instantiated_model_not_found' } } }
        }
        const instantiated = await instantiatedModel.instantiated
        if (!instantiated) {
            trainingSessions.delete(args.trainingSessionId)
            return { result: { error: { code: 'instantiated_model_not_found' } } }
        }
        const complete = { complete: false }
        const params = createDataLoaderMap(complete, args.params, sendDataEventToParent)
        try {
            if (typeof instantiated.train !== 'function') {
                throw `Train: Failed to call train on the instantiated model. Expected the property "train" to be a function, but got ${
                    instantiated.train === null ? 'null' : typeof instantiated.train
                }`
            }
            await instantiated.train({ params, tracker })
            tracker._complete = true
            complete.complete = true
        } catch (e) {
            tracker._complete = true
            complete.complete = true
            trainingSessions.delete(args.trainingSessionId)
            return { result: { error: getErrorFromException(e) } }
        }
        trainingSessions.delete(args.trainingSessionId)
        return { result: {} }
    },
    callCancelTrain(args) {
        const tracker = trainingSessions.get(args.trainingSessionId)
        if (tracker) {
            trainingSessions.delete(args.trainingSessionId)
            tracker.cancelled = true
            tracker._onCancel.forEach((cancel) => cancel())
        }
        return null
    },
    async callEvaluate(args) {
        const instantiatedModel = instantiatedModels.get(args.instantiatedModelId)
        if (!instantiatedModel) {
            return { result: { error: { code: 'instantiated_model_not_found' } } }
        }
        const instantiated = await instantiatedModel.instantiated
        if (!instantiated) {
            return { result: { error: { code: 'instantiated_model_not_found' } } }
        }
        const complete = { complete: false }
        const params = createDataLoaderMap(complete, args.params, sendDataEventToParent)
        let result: { name: string; data: Buffer[] }[]
        try {
            if (typeof instantiated.evaluate !== 'function') {
                throw `Evaluate: Failed to call evaluate on the instantiated model. Expected the property "evaluate" to be a function, but got ${
                    instantiated.evaluate === null ? 'null' : typeof instantiated.evaluate
                }`
            }
            result = await instantiated.evaluate({ params })
            complete.complete = true
            if (!Array.isArray(result)) {
                throw `Evaluate: Expected return value of "evaluate" to be an array.`
            }
            result.forEach((el, idx) => {
                if (el === null || typeof el !== 'object') {
                    throw `Evaluate: Expected each element in the return array of "evaluate" to be an object. Got element of type ${
                        el === null ? 'null' : typeof el
                    } at position ${idx}`
                }
                if (typeof el.name !== 'string') {
                    throw `Evaluate: Expected each element in the return array of "evaluate" to contain a field "name" that is a string. Got "name": ${
                        el.name === null ? 'null' : typeof el.name
                    } at position ${idx}`
                }
                if (!Array.isArray(el.data)) {
                    throw `Evaluate: Expected each element in the return array of "evaluate" to contain a field "data" that is an array. Got "data": ${
                        el.data === null ? 'null' : typeof el.data === 'object' ? 'Not an array' : typeof el.data
                    }`
                }
                if (el.data.some((el) => !Buffer.isBuffer(el))) {
                    throw `Evaluate: Expected each element in the return array of "evaluate" to contain a field "data" that is an array of buffers. Got something other than buffer.`
                }
            })
        } catch (e) {
            return { result: { error: getErrorFromException(e) } }
        }

        return {
            result: {
                outputs: result.map((el) => ({ name: el.name, byteSizes: el.data.map((x) => x.byteLength), amount: el.data.length }))
            },
            alsoSend: [Buffer.concat(result.flatMap((x) => x.data))]
        }
    },
    async callGetModelState(args) {
        const instantiatedModel = instantiatedModels.get(args.instantiatedModelId)
        if (!instantiatedModel) {
            return { result: { error: { code: 'instantiated_model_not_found' } } }
        }
        const instantiated = await instantiatedModel.instantiated
        if (!instantiated) {
            return { result: { error: { code: 'instantiated_model_not_found' } } }
        }

        const complete = { complete: false }
        const stateProvider = createStateProvider(complete, args.id, sendEventToParent)

        try {
            if (typeof instantiated.getModelState !== 'function') {
                throw `GetModelState: Failed to call getModelState on the instantiated model. Expected the property "getModelState" to be a function, but got ${
                    instantiated.getModelState === null ? 'null' : typeof instantiated.getModelState
                }`
            }
            await instantiated.getModelState({ stateProvider })
            complete.complete = true
        } catch (e) {
            return { result: { error: getErrorFromException(e) } }
        }

        return { result: {} }
    }
}

const processMessage = async (buf: Buffer) => {
    const parsed: { method: keyof ChildRpc; params: any } = JSON.parse(buf.toString())

    let response: Promise<{ result: any; alsoSend?: Buffer[] }> | { result: any; alsoSend?: Buffer[] } = (rpc[parsed.method] as any)(parsed.params)

    const _response = response instanceof Promise ? await response : response

    if (parsed.params.id === undefined || parsed.params.id === null) {
        return
    }

    const toSend = [Buffer.from(JSON.stringify({ id: parsed.params.id, result: _response.result })), ...(_response.alsoSend || [])]

    let argsTotalSize = 0
    toSend.forEach((el) => {
        argsTotalSize += el.length
    })

    const finalBuffer = Buffer.alloc(6 + toSend.length * 8 + argsTotalSize)
    finalBuffer[0] = 0
    finalBuffer.writeUInt32BE(toSend.length - 1, 1)

    let position = 5
    toSend.forEach((el) => {
        finalBuffer.writeUInt32BE(el.length, position + 4)
        el.copy(finalBuffer, position + 8)
        position += 8 + el.length
    })

    finalBuffer[position] = 0

    sendMessageToParent(finalBuffer)
}

let sock = net.connect({ path: process.env.IPC_PATH })
async function readBytesFromHost(amount: number): Promise<Buffer> {
    if (amount == 0) {
        return Buffer.alloc(0)
    }
    while (sock.readableLength < amount) {
        await new Promise<void>((resolve) => {
            let listener = () => {
                resolve()
                sock.off('readable', listener)
            }
            sock.on('readable', () => resolve())
        })
    }
    const chunks: Buffer[] = []
    while (true) {
        let length = chunks.reduce((acc, curr) => acc + curr.byteLength, 0)
        if (length >= amount) {
            return Buffer.concat(chunks)
        }
        chunks.push(sock.read(amount - length))
    }
}

new Promise(async () => {
    while (true) {
        const firstByte = (await readBytesFromHost(1))[0]
        if (firstByte === 0) {
            // RPC
            const blobLength = (await readBytesFromHost(8)).readUint32BE(4)
            const blobData = await readBytesFromHost(blobLength)
            processMessage(blobData)
        } else {
            // Provide data
            const requestId = (await readBytesFromHost(4)).readUint32BE()
            const numBlobs = (await readBytesFromHost(4)).readUint32BE()
            const data: Buffer[] = []
            for (let i = 0; i < numBlobs; i++) {
                const blobLength = (await readBytesFromHost(8)).readUint32BE(4)
                const blobData = await readBytesFromHost(blobLength)
                data.push(blobData)
            }
            onDataProvided(requestId, data)
        }
    }
})

sock.on('error', (err) => {
    console.log('ERROR: In communication with host: ', err)
    process.exit(1)
})

function sendMessageToParent(message: Buffer) {
    sock.write(message)
}

export function sendEventToParent(event: string, params: any, blobs: Buffer[]) {
    const toSend = [Buffer.from(JSON.stringify({ event, params })), ...blobs]

    let argsTotalSize = 0
    toSend.forEach((el) => {
        argsTotalSize += el.length
    })

    const finalBuffer = Buffer.alloc(6 + toSend.length * 8 + argsTotalSize)
    finalBuffer[0] = 0
    finalBuffer.writeUInt32BE(toSend.length - 1, 1)

    let position = 5
    toSend.forEach((el) => {
        finalBuffer.writeUInt32BE(el.length, position + 4)
        el.copy(finalBuffer, position + 8)
        position += 8 + el.length
    })

    finalBuffer[position] = 0

    sendMessageToParent(finalBuffer)
}

function sendDataEventToParent(event: DataEvent) {
    const serialized = Buffer.from(JSON.stringify(event))
    const lenBuf = Buffer.alloc(8)
    lenBuf.writeUint32BE(serialized.byteLength, 4)

    sendMessageToParent(Buffer.concat([Buffer.from([1]), lenBuf, serialized]))
}

import { DecthingsTensor } from '@decthings/api-client'
import { DataLoader } from './dataloader'
import { TrainTracker } from './traintracker'
import { DataLoaderBinary, ModelBinary, WeightsLoader, WeightsProvider } from '../exported'

export * from './dataloader'
export * from './traintracker'

export type InitializeWeightsFn = (options: {
    params: Map<string, DataLoader>
    weightsProvider: WeightsProvider
    otherModels: Map<
        string,
        {
            mountPath: string
            weights: Map<string, WeightsLoader>
        }
    >
}) => Promise<void> | void

export type InstantiateModelFn = (options: {
    weights: Map<string, WeightsLoader>
    otherModels: Map<string, { mountPath: string }>
}) => Promise<InstantiatedModel> | InstantiatedModel

/**
 * This is the main entry point for a Decthings model. An object or class implementing this interface should be used as
 * the default export in your model `index.js`.
 */
export interface Model {
    /**
     * The 'initializeWeights' function should create a new set of weights, possibly based on some configuration
     * parameters in the *params* argument. Weights in this context can be any binary data. For a neural network it is
     * typically the weights and biases of the network.
     *
     * Use the *params* argument to read user-provided configuration parameters, and the *weightsProvider* argument to
     * export the weights data.
     */
    initializeWeights: InitializeWeightsFn

    /**
     * The 'instantiateModel' function should load the weights that previously was created. This happens before train or
     * evaluate is called.
     *
     * Use the *weights* argument to load the previously created weights, and return an object or class containing the methods
     * `train` and `evaluate`.
     */
    instantiateModel: InstantiateModelFn
}

export type TrainFn = (options: { params: Map<string, DataLoader>; tracker: TrainTracker }) => Promise<void> | void

export type EvaluateFn = (options: {
    params: Map<string, DataLoader>
}) => Promise<{ name: string; data: DecthingsTensor[] }[]> | { name: string; data: DecthingsTensor[] }[]

export type GetWeightsFn = (options: { weightsProvider: WeightsProvider }) => Promise<void> | void

export interface InstantiatedModel {
    /**
     * The 'evaluate' function reads some input data and performs some computation to transform it into some output data.
     *
     * Use the *params* argument to read the input data, and return an array of output data of the form
     *
     * ```typescript
     * { name: string, data: DecthingsTensor[] }[]
     * ```
     */
    evaluate: EvaluateFn
    /**
     * The 'train' function updates the model weights, often by looking at some input data.
     *
     * Use the *params* argument to read the input data, and use the *tracker* argument to provide useful information to
     * the caller, such as progress and metrics. The new model weights are not returned from this function - instead, the
     * 'getWeights' function will later be called, which should return the new, trained weights.
     */
    train: TrainFn
    /**
     * The 'getWeights' function is called after the train function has completed. The function should then output the
     * new, trained weights.
     */
    getWeights: GetWeightsFn
    /**
     * When 'dispose' is called, it means that 'evaluate', 'train' and 'getWeights' will not be called again for this
     * particular instantiated model. If you have something to clean up, do that here. Otherwise, you can remove this
     * function.
     *
     * Because JavaScript is a garbage collected language, this function can in most cases be omitted.
     */
    dispose?: () => void
}

function createDataLoaderMap(params: Map<string, DataLoaderBinary>): Map<string, DataLoader> {
    return new Map(
        Array.from(params.entries()).map(([name, loader]) => {
            return [name, new DataLoader(loader)]
        })
    )
}

/**
 * Create a Decthings model by calling this function and exporting the returned value as the default export.
 *
 * Place the following in `index.ts` (and compile using TypeScript `tsc`):
 *
 * ```typescript
 * import * as decthings from '@decthings/model'
 *
 * export default decthings.makeModel({
 *     initializeWeights: async (options) => {
 *         ....
 *     },
 *     instantiateModel: async (options) => {
 *         ...
 *     }
 * })
 * ```
 */
export function makeModel(model: Model): ModelBinary {
    return {
        initializeWeights: ({ params, weightsProvider, otherModels }) => {
            if (!('initializeWeights' in model)) {
                throw new Error('The function "initializeWeights" was missing from the model.')
            }
            if (typeof model.initializeWeights !== 'function') {
                throw new Error(`The property "initializeWeights" on the model was not a function - found ${typeof model.initializeWeights}`)
            }
            return model.initializeWeights({ params: createDataLoaderMap(params), weightsProvider, otherModels })
        },
        instantiateModel: async (options) => {
            if (!('instantiateModel' in model)) {
                throw new Error('The function "instantiateModel" was missing from the model.')
            }
            if (typeof model.instantiateModel !== 'function') {
                throw new Error(`The property "instantiateModel" on the model was not a function - found ${typeof model.instantiateModel}`)
            }
            const instantiated = await model.instantiateModel(options)
            if (instantiated === null || typeof instantiated !== 'object') {
                throw new Error(
                    `Instantiate model: Expected return type of "instantiateModel" to be an object or class instance, not ${
                        instantiated === null ? 'null' : typeof instantiated
                    }`
                )
            }
            return {
                evaluate: async ({ params }) => {
                    if (!('evaluate' in instantiated)) {
                        throw new Error('The function "evaluate" was missing from the instantiated model.')
                    }
                    if (typeof instantiated.evaluate !== 'function') {
                        throw new Error(`The property "evaluate" on the instantiated model was not a function - found ${typeof instantiated.evaluate}`)
                    }
                    const res = await instantiated.evaluate({ params: createDataLoaderMap(params) })
                    if (!Array.isArray(res)) {
                        throw new Error(`Evaluate: Expected return value of "evaluate" to be an array.`)
                    }
                    return res.map((outputParam) => {
                        if (outputParam === null || typeof outputParam !== 'object') {
                            throw new Error(
                                `Evaluate: Expected each element in return array of "evaluate" to be of type object, not ${
                                    outputParam === null ? 'null' : typeof outputParam
                                }`
                            )
                        }
                        if (outputParam.data === undefined) {
                            throw new Error('Evaluate: Expected each element in return array of "evaluate" to contain a field "data".')
                        }
                        if (!Array.isArray(outputParam.data)) {
                            throw new Error('Evaluate: Expected the field "data" in each element of return array of "evaluate" to be an array.')
                        }
                        return {
                            name: outputParam.name,
                            data: outputParam.data.map((value) => {
                                if (!(value instanceof DecthingsTensor)) {
                                    throw new Error(
                                        'Evaluate: Expected each element in the list "data" in each element of return array of "evaluate" to be a DecthingsTensor.'
                                    )
                                }
                                return value.serialize()
                            })
                        }
                    })
                },
                dispose: () => {
                    if (!('dispose' in instantiated)) {
                        return
                    }
                    if (typeof instantiated.dispose !== 'function') {
                        throw new Error(`The property "dispose" on the instantiated model was not a function - found ${typeof instantiated.dispose}`)
                    }
                    return instantiated.dispose()
                },
                getWeights: (options) => {
                    if (!('getWeights' in instantiated)) {
                        throw new Error('The function "getWeights" was missing from the instantiated model.')
                    }
                    if (typeof instantiated.getWeights !== 'function') {
                        throw new Error(`The property "getWeights" on the instantiated model was not a function - found ${typeof instantiated.getWeights}`)
                    }
                    return instantiated.getWeights(options)
                },
                train: ({ params, tracker }) => {
                    if (!('train' in instantiated)) {
                        throw new Error('The function "train" was missing from the instantiated model.')
                    }
                    if (typeof instantiated.train !== 'function') {
                        throw new Error(`The property "train" on the instantiated model was not a function - found ${typeof instantiated.train}`)
                    }
                    return instantiated.train({ params: createDataLoaderMap(params), tracker: new TrainTracker(tracker) })
                }
            }
        }
    }
}

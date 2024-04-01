import { DecthingsTensor } from '@decthings/api-client'
import { DataLoader } from './dataloader'
import { TrainTracker } from './traintracker'
import { DataLoaderBinary, ModelBinary, StateLoader, StateProvider } from '../exported'

export * from './dataloader'
export * from './traintracker'

export type CreateModelStateFn = (params: Map<string, DataLoader>, provider: StateProvider) => Promise<void> | void

export type InstantiateModelFn = (state: Map<string, StateLoader>) => Promise<InstantiatedModel> | InstantiatedModel

/**
 * This is the main entry point for a Decthings model. An object or class implementing this interface should be used as
 * the default export in your model `index.js`.
 */
export interface Model {
    /**
     * The 'createModelState' function should create a new state, possibly based on some configuration parameters in the
     * *params* argument. A model state is some binary data which later can be used in evaluate and train. For example,
     * for a neural network, the createModelState should generate a new randomized set of weights and biases.
     *
     * Use the *params* argument to read user-provided configuration parameters, and the *provider* argument to export
     * the state data.
     */
    createModelState: CreateModelStateFn

    /**
     * The 'instantiateModel' function should load the state that previously was created. This happens before train or
     * evaluate is called.
     *
     * Use the *state* argument to load the previously created state, and return an object or class containing the methods
     * `train` and `evaluate`.
     */
    instantiateModel: InstantiateModelFn
}

export type TrainFn = (params: Map<string, DataLoader>, tracker: TrainTracker) => Promise<void> | void

export type EvaluateFn = (params: Map<string, DataLoader>) => Promise<{ name: string; data: DecthingsTensor[] }[]> | { name: string; data: DecthingsTensor[] }[]

export type GetModelStateFn = (provider: StateProvider) => Promise<void> | void

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
     * The 'train' function updates the model state, often by looking at some input data.
     *
     * Use the *params* argument to read the input data, and use the *tracker* argument to provide useful information to
     * the caller, such as progress and metrics. The new model state is not returned from this function - instead, the
     * 'getModelState' function will later be called, which should return the new, trained state.
     */
    train: TrainFn
    /**
     * The 'getModelState' function is called after the train function has completed. The function should then output the
     * new, trained state.
     */
    getModelState: GetModelStateFn
    /**
     * When 'dispose' is called, it means that 'evaluate', 'train' and 'getModelState' will not be called again for this
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
 *     createModelState: async (params, provider) => {
 *         ....
 *     },
 *     instantiateModel: async (state) => {
 *         ...
 *     }
 * })
 * ```
 */
export function makeModel(model: Model): ModelBinary {
    return {
        createModelState: (params, provider) => {
            if (!('createModelState' in model)) {
                throw new Error('The function "instantiateModel" was missing from the model.')
            }
            if (typeof model.createModelState !== 'function') {
                throw new Error(`The property "createModelState" on the model was not a function - found ${typeof model.createModelState}`)
            }
            return model.createModelState(createDataLoaderMap(params), provider)
        },
        instantiateModel: async (state) => {
            if (!('instantiateModel' in model)) {
                throw new Error('The function "instantiateModel" was missing from the model.')
            }
            if (typeof model.instantiateModel !== 'function') {
                throw new Error(`The property "instantiateModel" on the model was not a function - found ${typeof model.instantiateModel}`)
            }
            const instantiated = await model.instantiateModel(state)
            if (instantiated === null || typeof instantiated !== 'object') {
                throw new Error(
                    `Instantiate model: Expected return type of "instantiateModel" to be an object or class instance, not ${
                        instantiated === null ? 'null' : typeof instantiated
                    }`
                )
            }
            return {
                evaluate: async (params) => {
                    if (!('evaluate' in instantiated)) {
                        throw new Error('The function "evaluate" was missing from the instantiated model.')
                    }
                    if (typeof instantiated.evaluate !== 'function') {
                        throw new Error(`The property "evaluate" on the instantiated model was not a function - found ${typeof instantiated.evaluate}`)
                    }
                    const res = await instantiated.evaluate(createDataLoaderMap(params))
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
                getModelState: (provider) => {
                    if (!('getModelState' in instantiated)) {
                        throw new Error('The function "getModelState" was missing from the instantiated model.')
                    }
                    if (typeof instantiated.getModelState !== 'function') {
                        throw new Error(
                            `The property "getModelState" on the instantiated model was not a function - found ${typeof instantiated.getModelState}`
                        )
                    }
                    return instantiated.getModelState(provider)
                },
                train: (params, tracker) => {
                    if (!('train' in instantiated)) {
                        throw new Error('The function "train" was missing from the instantiated model.')
                    }
                    if (typeof instantiated.train !== 'function') {
                        throw new Error(`The property "train" on the instantiated model was not a function - found ${typeof instantiated.train}`)
                    }
                    return instantiated.train(createDataLoaderMap(params), new TrainTracker(tracker))
                }
            }
        }
    }
}

export type DataEvent =
    | { event: 'requestData'; dataset: string; requestId: number; startIndex: number; amount: number }
    | { event: 'shuffle'; datasets: string[] }

export type Param = {
    name: string
    dataset: string
    amount: number
    totalByteSize: number
}

export interface ChildRpc {
    initialize(args: { path: string }): Promise<null>
    callInitializeWeights(args: { id: string; params: Param[]; otherModels: { id: string; mountPath: string; weights: Param[] }[] }): Promise<{
        error?: {
            code: 'exception'
            details?: string
        }
    }>
    callInstantiateModel(args: { id: string; instantiatedModelId: string; weights: Param[]; otherModels: { id: string; mountPath: string }[] }): Promise<{
        error?: {
            code: 'exception'
            details?: string
        }
    }>
    callDisposeInstantiatedModel(args: { instantiatedModelId: string }): Promise<null>
    callTrain(args: { id: string; trainingSessionId: string; instantiatedModelId: string; params: Param[] }): Promise<{
        error?:
            | {
                  code: 'exception'
                  details?: string
              }
            | {
                  code: 'instantiated_model_not_found' | 'instantiated_model_is_being_created'
              }
    }>
    callCancelTrain(args: { trainingSessionId: string }): Promise<null>
    callEvaluate(args: { id: string; instantiatedModelId: string; params: Param[] }): Promise<{
        error?:
            | {
                  code: 'exception'
                  details?: string
              }
            | {
                  code: 'instantiated_model_not_found'
              }
        outputs?: { name: string; byteSizes: number[] }[]
    }>
    callGetWeights(args: { id: string; instantiatedModelId: string }): Promise<{
        error?:
            | {
                  code: 'exception'
                  details?: string
              }
            | {
                  code: 'instantiated_model_not_found' | 'instantiated_model_is_being_created'
              }
    }>
}

export interface WeightsLoader {
    /**
     * Get the size of the weight data.
     */
    byteSize(): number
    /**
     * Read the weight data.
     */
    read(): Promise<Buffer>
}

export interface WeightsProvider {
    provideAll(data: { key: string; data: Buffer }[]): void

    provide(key: string, data: Buffer): void
}

export interface DataLoaderBinary {
    totalByteSize(): number
    size(): number
    shuffle(): void
    shuffleInGroup(others: DataLoaderBinary[]): void
    position(): number
    setPosition(position: number): void
    remaining(): number
    hasNext(amount?: number): boolean
    next(amount?: number): Promise<Buffer[]>
}

export interface TrainTrackerBinary {
    onCancel(cb: () => void): void
    metrics(metrics: { name: string; value: Buffer }[]): void
    progress(progress: number): void
}

export interface ModelBinary {
    initializeWeights(options: {
        params: Map<string, DataLoaderBinary>
        weightsProvider: WeightsProvider
        otherModels: Map<
            string,
            {
                mountPath: string
                weights: Map<string, WeightsLoader>
            }
        >
    }): Promise<void> | void
    instantiateModel(options: {
        weights: Map<string, WeightsLoader>
        otherModels: Map<string, { mountPath: string }>
    }): Promise<InstantiatedModelBinary> | InstantiatedModelBinary
}

export interface InstantiatedModelBinary {
    train(options: { params: Map<string, DataLoaderBinary>; tracker: TrainTrackerBinary }): Promise<void> | void
    evaluate(options: { params: Map<string, DataLoaderBinary> }): Promise<{ name: string; data: Buffer[] }[]> | { name: string; data: Buffer[] }[]
    getWeights(options: { weightsProvider: WeightsProvider }): Promise<void> | void
    dispose(): void
}

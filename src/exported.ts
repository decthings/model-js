export interface StateLoader {
    /**
     * Get the size of the state data.
     */
    byteSize(): number
    /**
     * Read the state data.
     */
    read(): Promise<Buffer>
}

export interface StateProvider {
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
    createModelState(params: Map<string, DataLoaderBinary>, provider: StateProvider, otherModels: Map<string, Map<string, StateLoader>>): Promise<void> | void
    instantiateModel(state: Map<string, StateLoader>): Promise<InstantiatedModelBinary> | InstantiatedModelBinary
}

export interface InstantiatedModelBinary {
    train(params: Map<string, DataLoaderBinary>, tracker: TrainTrackerBinary): Promise<void> | void
    evaluate(params: Map<string, DataLoaderBinary>): Promise<{ name: string; data: Buffer[] }[]> | { name: string; data: Buffer[] }[]
    getModelState(provider: StateProvider): Promise<void> | void
    dispose(): void
}

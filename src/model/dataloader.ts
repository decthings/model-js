import { DecthingsTensor } from '@decthings/api-client'
import { DataLoaderBinary } from '../exported'

/**
 * DataLoader allows you to asynchronously read data in batches. This should be done for large datasets, since loading all
 * data at once might require too much memory.
 *
 * Examples:
 * To read all data:
 * \`\`\`
 * let data = await loader.next(loader.size())
 * \`\`\`
 *
 * Read in batches of 10:
 * \`\`\`
 * while (loader.hasNext()) {
 *     let data = await loader.next(10)
 * }
 * \`\`\`
 */
export class DataLoader {
    constructor(private _inner: DataLoaderBinary) {}
    /**
     * Get the total byte size of all elements in the data array.
     */
    totalByteSize(): number {
        return this._inner.totalByteSize()
    }
    /**
     * Get the total number of elements in the data array.
     */
    public size(): number {
        return this._inner.size()
    }
    /**
     * Randomize the data order.
     */
    public shuffle(): void {
        return this._inner.shuffle()
    }
    /**
     * Randomize the data order. The data loaders in *others* will be shuffled in the same order.
     */
    shuffleInGroup(others: DataLoader[]): void {
        if (!Array.isArray(others) || others.some((x) => !(x instanceof DataLoader))) {
            throw new Error(`DataLoader shuffleInGroup: Expected "others" to be an array of DataLoaders.`)
        }
        return this._inner.shuffleInGroup(others.map((x) => x._inner))
    }
    /**
     * Get the current read-position of the data loader. When calling next(), the loader will read from this position.
     */
    public position(): number {
        return this._inner.position()
    }
    /**
     * Set the current read-position of the data loader.
     */
    public setPosition(position: number): void {
        return this._inner.setPosition(position)
    }
    /**
     * Returns the number of elements from the current read-position to the end of the data array.
     */
    public remaining(): number {
        return this._inner.remaining()
    }
    /**
     * Checks whether there are *amount* number of elements left in the array or not.
     * @param amount Defaults to 1.
     */
    public hasNext(amount?: number): boolean {
        return this._inner.hasNext(amount)
    }
    /**
     * Reads *amount* number of elements. If there are not enough elements left, the returned array will be shorter than *amount*.
     * @param amount Defaults to 1.
     */
    public async next(amount?: number): Promise<DecthingsTensor[]> {
        const res = await this._inner.next(amount)
        return res.map((el) => DecthingsTensor.deserialize(el)[0])
    }
}

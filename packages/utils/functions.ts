export const withComputation = <F extends (...args: any[]) => any, SF extends (...args: Parameters<F>) => any = (...args: Parameters<F>) => void>(v: ReturnType<F>, f: SF) => (...args: Parameters<F>) => {
    f(...args)
    return v
}

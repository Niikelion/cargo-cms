export const withComputation = <F extends (...args: any[]) => any, SF extends (...args: Parameters<F>) => any = (...args: Parameters<F>) => void>(v: ReturnType<F>, f: SF) => (...args: Parameters<F>) => {
    f(...args)
    return v
}

const f = (a: number): number => a
type F = typeof f

const takesF = (f: F): number => withComputation(4, f)(5)
const ff = (n: number): number => withComputation<(a: number)=>number>(4, (a) => {
    //
})(n)
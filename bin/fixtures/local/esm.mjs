let count = 0;
export async function lambda(event) {
    await new Promise(resolve => setImmediate(resolve));
    return { count: ++count, event };
}

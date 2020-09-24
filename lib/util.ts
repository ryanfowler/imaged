export interface PromiseFulfilled<T> {
  status: "fulfilled";
  value: T;
}

export interface PromiseRejected {
  status: "rejected";
  reason: unknown;
}

export type PromiseResult<T> = PromiseFulfilled<T> | PromiseRejected;

export const wait = async <T>(p: Promise<T>): Promise<PromiseResult<T>> => {
  try {
    const res = await p;
    return { status: "fulfilled", value: res };
  } catch (error) {
    return { status: "rejected", reason: error };
  }
};

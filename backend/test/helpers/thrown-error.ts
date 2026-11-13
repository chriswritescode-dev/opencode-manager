export function catchThrownError(action: () => void): Error {
  try {
    action()
  } catch (error) {
    if (error instanceof Error) return error
    throw error
  }
  throw new Error('Expected the action to throw')
}

export async function catchRejectedError(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise
  } catch (error) {
    if (error instanceof Error) return error
    throw error
  }
  throw new Error('Expected the promise to reject')
}

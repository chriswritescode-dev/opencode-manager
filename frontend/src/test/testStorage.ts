const testStorage = (() => {
  const store = new Map<string, string>()
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
    clear: () => store.clear(),
  }
})()

Object.defineProperty(window, 'localStorage', {
  value: testStorage,
  writable: true,
})

Object.defineProperty(globalThis, 'localStorage', {
  value: window.localStorage,
  writable: true,
})

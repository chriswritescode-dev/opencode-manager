export class GitAuthenticationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GitAuthenticationError'
  }
}

export class GitConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GitConflictError'
  }
}

export class GitNotFoundError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GitNotFoundError'
  }
}

export class GitOperationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GitOperationError'
  }
}

export type ApiErrorCode =
  | "UNAUTHORIZED"
  | "AUTH_FORBIDDEN"
  | "NOT_FOUND"
  | "BAD_REQUEST"
  | "VALIDATION_ERROR"
  | "INVALID_STATE_TRANSITION"
  | "SCHEDULE_CONFLICT"
  | "DATABASE_ERROR"
  | "DATABASE_SETUP_REQUIRED"

export type ApiSuccess<T> = {
  success: true
  data: T
  message?: string
}

export type ApiFailure = {
  success: false
  error: {
    code: ApiErrorCode | string
    status: number
    message: string
    details?: unknown
  }
  message?: string
}

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure

export function apiSuccess<T>(data: T, message?: string): ApiSuccess<T> {
  return { success: true, data, ...(message ? { message } : {}) }
}

export function apiError(
  code: ApiErrorCode | string,
  status: number,
  message: string,
  details?: unknown
): ApiFailure {
  return {
    success: false,
    error: {
      code,
      status,
      message,
      ...(details === undefined ? {} : { details }),
    },
  }
}

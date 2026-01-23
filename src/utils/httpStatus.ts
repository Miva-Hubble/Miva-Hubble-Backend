export class HttpStatus {
  // Success
  static readonly OK = 200;
  static readonly CREATED = 201;
  static readonly NO_CONTENT = 204;

  // Client Errors
  static readonly BAD_REQUEST = 400;
  static readonly UNAUTHORIZED = 401;
  static readonly FORBIDDEN = 403;
  static readonly NOT_FOUND = 404;
  static readonly CONFLICT = 409;
  static readonly UNPROCESSABLE_ENTITY = 422;

  // Server Errors
  static readonly INTERNAL_SERVER_ERROR = 500;
  static readonly BAD_GATEWAY = 502;
  static readonly SERVICE_UNAVAILABLE = 503;
}

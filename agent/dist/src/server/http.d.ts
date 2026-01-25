/**
 * Blossom Agent HTTP Server
 * Provides API endpoints for the React front-end
 */
declare const app: import("express-serve-static-core").Express;
declare global {
    namespace Express {
        interface Request {
            correlationId?: string;
        }
    }
}
export { app };
//# sourceMappingURL=http.d.ts.map
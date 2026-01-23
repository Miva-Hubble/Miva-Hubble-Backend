import { z } from "zod";
import { extendZodWithOpenApi } from "@asteasolutions/zod-to-openapi";

extendZodWithOpenApi(z);

export const CreateUserSchema = z.object({
  body: z.object({
    email: z.string().email().openapi({ example: "user@example.com" }),
    password: z.string().min(8).openapi({ example: "securepass123" }),
    name: z.string().min(2).openapi({ example: "John Doe" }),
  }),
});

export const UserResponseSchema = z
  .object({
    id: z.string().openapi({ example: "usr_123abc" }),
    email: z.string().email().openapi({ example: "user@example.com" }),
    name: z.string().openapi({ example: "John Doe" }),
    createdAt: z.string().datetime().openapi({ example: "2026-01-10T12:00:00Z" }),
  })
  .openapi("User");

export const GetUserSchema = z.object({
  params: z.object({
    id: z.string().openapi({ example: "usr_123abc" }),
  }),
});

export const ErrorResponseSchema = z
  .object({
    error: z.string().openapi({ example: "Resource not found" }),
    details: z.any().optional(),
  })
  .openapi("Error");

export type CreateUserInput = z.infer<typeof CreateUserSchema>;
export type UserResponse = z.infer<typeof UserResponseSchema>;
export type GetUserInput = z.infer<typeof GetUserSchema>;

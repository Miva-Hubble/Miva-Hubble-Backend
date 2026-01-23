import { Router, Request, Response } from "express";
import { validate } from "../middleware/validate.js";
import { CreateUserSchema, GetUserSchema, UserResponse } from "../schemas/user.schema.js";

const router = Router();

// In-memory store (replace with real DB)
const users: UserResponse[] = [];

// POST /users - Create user
router.post("/", validate(CreateUserSchema), (req: Request, res: Response) => {
  const newUser: UserResponse = {
    id: `usr_${Date.now()}`,
    email: req.body.email,
    name: req.body.name,
    createdAt: new Date().toISOString(),
  };

  users.push(newUser);
  res.status(201).json(newUser);
});

// GET /users - List all users
router.get("/", (_req: Request, res: Response) => {
  res.json(users);
});

// GET /users/:id - Get user by ID
router.get("/:id", validate(GetUserSchema), (req: Request, res: Response) => {
  const user = users.find((u) => u.id === req.params.id);

  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }

  res.json(user);
});

export default router;

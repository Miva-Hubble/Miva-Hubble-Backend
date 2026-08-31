import { Router } from "express";
import { LEVELS, DEPARTMENTS, GOALS, AUDIENCE_TAGS, TARGETING_WILDCARD } from "../constants/taxonomy.js";

const router = Router();

router.get("/", (_req, res) => {
  res.json({
    success: true,
    levels: LEVELS,
    departments: DEPARTMENTS,
    goals: GOALS,
    audienceTags: AUDIENCE_TAGS,
    wildcard: TARGETING_WILDCARD,
  });
});

export default router;

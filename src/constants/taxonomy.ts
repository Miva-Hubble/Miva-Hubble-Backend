export const LEVELS = ["100", "200", "300", "400", "500"] as const;

export const DEPARTMENTS = [
  "Computer Science",
  "Engineering",
  "Business",
  "Medicine",
  "Arts",
  "Information Technology",
  "Data Science",
  "Cybersecurity",
] as const;

export const GOALS = [
  "Find study materials",
  "Connect with classmates",
  "Ask academic questions",
  "Prepare for exams",
  "Career opportunities",
  "Access past questions",
  "Find study partners",
  "Learn from senior students",
] as const;

export const AUDIENCE_TAGS = [
  "AI Track",
  "Data Science",
  "Cybersecurity",
  "Software Eng.",
  "Clinical",
  "Research",
  "Entrepreneurship",
  "Finance",
  "Public Health",
  "Robotics",
] as const;

export const TARGETING_WILDCARD = "All" as const;

export type Level = (typeof LEVELS)[number];
export type Department = (typeof DEPARTMENTS)[number];
export type Goal = (typeof GOALS)[number];
export type AudienceTag = (typeof AUDIENCE_TAGS)[number];

// Exception steps that have no screen of their own; the database checks role and reason
export const EXCEPTIONS = ["cancelled", "lost_in_transit", "closed", "ready_to_return"] as const;
export type ExceptionTarget = (typeof EXCEPTIONS)[number];

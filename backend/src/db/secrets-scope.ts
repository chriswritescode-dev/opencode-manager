/**
 * Repo scope stored in place of a NULL `repo_id` for global secrets, so the unique scope index
 * and its conflict target treat every global entry as one scope while repository scopes keep
 * their own. Real repo ids are `0` (the Assistant repository) or positive, so a negative
 * sentinel can never collide with one.
 */
export const GLOBAL_SECRETS_SCOPE_ID = -1

import { normalizeGestureTags, normalizeMovementKey } from "./recipe-store.js";

export const DEFAULT_MAX_RECIPES_PER_MOVEMENT = 3;

export function matchAutomationRecipes(snapshot, recipes = [], context = {}) {
  if (!snapshot?.confirmed || snapshot.uncertainty === true || snapshot.movement_key === "uncertain") return [];
  const movementKey = normalizeMovementKey(snapshot.movement_key || snapshot.short_label);
  const movementTags = new Set(normalizeGestureTags(snapshot.gesture_tags));
  const exactTexts = new Set([
    movementKey,
    String(snapshot.short_label || "").trim().toLowerCase(),
    String(snapshot.movement || snapshot.movement_sentence || "").trim().toLowerCase(),
    String(snapshot.corrected_movement || snapshot.confirmed_alias || "").trim().toLowerCase()
  ].filter(Boolean));

  return recipes
    .filter((recipe) => recipe?.enabled === true && (recipe.execution_mode || "confirmed_ai_movement") === "confirmed_ai_movement")
    .map((recipe) => {
      const trigger = recipe.trigger || {};
      const exactKey = normalizeMovementKey(trigger.movement_key) === movementKey;
      const wildcard = trigger.movement_key === "any_confirmed_movement";
      const requiredTags = normalizeGestureTags(trigger.required_tags);
      const tagMatch = requiredTags.every((tag) => movementTags.has(tag));
      const aliasMatch = (trigger.aliases || []).some((alias) => exactTexts.has(String(alias).trim().toLowerCase()));
      const identityRank = exactKey ? 2 : aliasMatch ? 1 : wildcard ? 0 : -1;
      return { recipe, identityRank, tagMatch, requiredTagCount: requiredTags.length };
    })
    .filter((candidate) => candidate.identityRank >= 0 && candidate.tagMatch)
    .filter(({ recipe }) => Number(snapshot.confidence ?? 0) >= Number(recipe.trigger?.minimum_confidence ?? 0))
    .filter(({ recipe }) => Number(context.cooldowns?.[recipe.recipe_id] ?? 0) <= Number(context.now ?? Date.now()))
    .filter(({ recipe }) => Number(context.sessionRuns?.[recipe.recipe_id] ?? 0) < Number(recipe.execution_policy?.max_runs_per_session ?? 1))
    .sort((a, b) => b.identityRank - a.identityRank || b.requiredTagCount - a.requiredTagCount || Number(b.recipe.priority || 0) - Number(a.recipe.priority || 0) || Number(b.recipe.trigger.minimum_confidence) - Number(a.recipe.trigger.minimum_confidence) || a.recipe.recipe_id.localeCompare(b.recipe.recipe_id))
    .slice(0, Math.max(1, Math.min(3, Number(context.maxMatches ?? DEFAULT_MAX_RECIPES_PER_MOVEMENT))))
    .map((candidate) => candidate.recipe);
}

export function recipeMatchBlockReason(snapshot, recipe, context = {}) {
  if (!snapshot?.confirmed) return "Movement must be confirmed first";
  if (snapshot.uncertainty === true) return "Uncertain movement cannot run automations";
  if (recipe?.enabled !== true) return "Automation is disabled";
  if (Number(snapshot.confidence ?? 0) < Number(recipe?.trigger?.minimum_confidence ?? 0)) return "Movement confidence is below the recipe threshold";
  if (Number(context.cooldowns?.[recipe.recipe_id] ?? 0) > Number(context.now ?? Date.now())) return "Recipe is cooling down";
  if (Number(context.sessionRuns?.[recipe.recipe_id] ?? 0) >= Number(recipe?.execution_policy?.max_runs_per_session ?? 1)) return "Recipe run limit reached";
  return "Recipe trigger did not match";
}

import { defineRule } from "@oxlint/plugins";

export const noRuntimeTypeofRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow runtime typeof checks; external values must be decoded into meaningful types at their I/O boundary.",
    },
    messages: {
      runtimeTypeof:
        "A `typeof` check narrows a representation without establishing its contract. Parse input at its I/O boundary, then branch on the domain value.",
    },
  },
  create(context) {
    return {
      UnaryExpression(node) {
        if (node.operator === "typeof") {
          context.report({ node, messageId: "runtimeTypeof" });
        }
      },
    };
  },
});

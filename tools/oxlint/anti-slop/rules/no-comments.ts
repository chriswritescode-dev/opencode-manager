import { defineRule } from "@oxlint/plugins";

export const noCommentsRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description: "Disallow every comment, including JSDoc comments.",
    },
    messages: {
      comment:
        "Remove this comment. Express intent through names, types, and tests instead of comments.",
    },
  },
  create(context) {
    return {
      Program() {
        for (const comment of context.sourceCode.getAllComments()) {
          if (comment.type === "Shebang") continue;
          context.report({ loc: comment.loc, messageId: "comment" });
        }
      },
    };
  },
});

import pino from "pino";

export const logger = pino({
  base: { service: "imaged" },
  formatters: {
    level: (label) => {
      return { level: label };
    },
  },
});

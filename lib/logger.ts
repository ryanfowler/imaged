import { version } from "../package.json";

import pino from "pino";

export const logger = pino({
  base: { app: "imaged", v: version },
  formatters: {
    level: (label) => {
      return { level: label };
    },
  },
});

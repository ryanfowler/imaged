import { version } from "../package.json";

import pino from "pino";

export const logger = pino({
  base: { service: "imaged", v: version },
  formatters: {
    level: (label) => {
      return { level: label };
    },
  },
});

import data from "./data.json";
import { getImageMetadata } from "./utils";

const timeout = 60_000;

data.inputs.forEach((input) => {
  data.outputs.forEach(async (output) => {
    test.concurrent(
      `crop height - input ${input.format} to output ${output.format}`,
      async () => {
        const metadata = await getImageMetadata(input.url, {
          format: output.format,
          height: "100",
        });
        expect(metadata.format).toEqual(output.sharpFormat);
        expect(metadata.height).toEqual(100);
        expect(metadata.width).toEqual(133);
      },
      timeout
    );

    test.concurrent(
      `crop width - input ${input.format} to output ${output.format}`,
      async () => {
        const metadata = await getImageMetadata(input.url, {
          format: output.format,
          width: "133",
        });
        expect(metadata.format).toEqual(output.sharpFormat);
        expect(metadata.height).toEqual(100);
        expect(metadata.width).toEqual(133);
      },
      timeout
    );

    test.concurrent(
      `crop height & width - input ${input.format} to output ${output.format}`,
      async () => {
        const metadata = await getImageMetadata(input.url, {
          format: output.format,
          height: "100",
          width: "100",
        });
        expect(metadata.format).toEqual(output.sharpFormat);
        expect(metadata.height).toEqual(100);
        expect(metadata.width).toEqual(100);
      },
      timeout
    );
  });
});

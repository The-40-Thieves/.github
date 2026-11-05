import { docsLoader } from "@astrojs/starlight/loaders";
import { docsSchema } from "@astrojs/starlight/schema";
import { defineCollection, z } from "astro:content";

export const collections = {
  docs: defineCollection({
    loader: docsLoader(),
    schema: docsSchema({
      // Written by scripts/sync-docs.mjs: the repository-relative path of the source file, which
      // the provenance stamp in the footer links to at the built commit.
      extend: z.object({ sourcePath: z.string().optional() }),
    }),
  }),
};

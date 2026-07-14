const themeLoaders = {
  "github-light": async () =>
    (await import("@shikijs/themes/github-light")).default,
  "one-dark-pro": async () =>
    (await import("@shikijs/themes/one-dark-pro")).default,
};

type ThemeName = keyof typeof themeLoaders;

export function createTheme({
  name,
  load,
}: {
  name: string;
  load: () => Promise<unknown>;
}) {
  return {
    name,
    load: async () => {
      const loaded = await load();
      return typeof loaded === "object" && loaded && "default" in loaded
        ? loaded.default
        : loaded;
    },
  };
}

export const pierreThemes = {
  getThemes: () => [],
};

export const shikiThemes = {
  getTheme: (name: string) =>
    name in themeLoaders
      ? {
          name,
          load: themeLoaders[name as ThemeName],
        }
      : undefined,
};

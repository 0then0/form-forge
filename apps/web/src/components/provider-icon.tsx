import Image from "next/image";

export const providerLabels = {
  google: "Google",
  github: "GitHub",
  chatgpt: "ChatGPT",
  apple: "Apple",
  gitlab: "GitLab",
} as const;

export type SignInProvider = keyof typeof providerLabels;

export const ProviderIcon = ({ provider }: { provider: SignInProvider }) => (
  <Image
    src={`/providers/${provider}.svg`}
    alt=""
    aria-hidden="true"
    width={22}
    height={22}
    className={`size-5.5 shrink-0 ${["github", "apple", "chatgpt"].includes(provider) ? "dark:invert" : ""}`}
  />
);

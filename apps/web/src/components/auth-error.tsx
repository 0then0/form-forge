import { Alert } from "@form-forge/ui";

export const AuthError = ({ error }: { error?: string | undefined }) =>
  error ? (
    <Alert className="mb-4">
      {error === "OAuthAccountNotLinked"
        ? "This sign-in method cannot be linked here. Sign in with your original method, then open Account → Sign-in methods to link it. A method already linked to another account cannot be transferred."
        : "Sign-in could not be completed. Please try again or use another linked sign-in method."}
    </Alert>
  ) : null;

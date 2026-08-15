"use client";

import * as Sentry from "@sentry/nextjs";
import { Alert } from "@form-forge/ui";
import { Component, type ReactNode } from "react";

type Props = { children: ReactNode; resetKey: string };
type State = { failed: boolean };

export class PreviewErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error) {
    Sentry.captureException(error, { tags: { widget: "schema-preview" } });
  }

  componentDidUpdate(previous: Props) {
    if (this.state.failed && previous.resetKey !== this.props.resetKey) {
      this.setState({ failed: false });
    }
  }

  render() {
    if (this.state.failed) {
      return (
        <Alert>
          The preview could not render this draft. Your editor changes are still
          available.
        </Alert>
      );
    }
    return this.props.children;
  }
}

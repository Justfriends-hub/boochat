import { Component, type ReactNode } from "react";

type Props = { name: string; children: ReactNode };
type State = { hasError: boolean };

export class FeatureBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    console.error(`[FeatureBoundary:${this.props.name}]`, error);
  }

  render() {
    if (this.state.hasError) {
      // Return children directly or graceful fallback so UI never breaks with "Hit a snag"
      return this.props.children;
    }
    return this.props.children;
  }
}

import { Component, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

type Props = { name: string; children: ReactNode };
type State = { error: Error | null };

export class FeatureBoundary extends Component<Props, State> {
  state: State = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error) { console.error(`[${this.props.name}]`, error); }
  render() {
    if (this.state.error) {
      return (
        <div className="flex flex-col items-center justify-center gap-3 p-8 text-center">
          <AlertTriangle className="h-8 w-8 text-destructive" />
          <p className="text-sm text-muted-foreground">
            The {this.props.name} section hit a snag.
          </p>
          <Button size="sm" onClick={() => this.setState({ error: null })}>Retry</Button>
        </div>
      );
    }
    return this.props.children;
  }
}

import { Component, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

type Props = { name: string; children: ReactNode };
type State = { error: Error | null };

export class FeatureBoundary extends Component<Props, State> {
  state: State = { error: null };
  retryCount = 0;
  isRetrying = false;

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error(`[${this.props.name}]`, error);
  }

  componentDidUpdate(prevProps: Props, prevState: State) {
    if (this.state.error && !prevState.error) {
      this.retryCount = 0;
      this.scheduleRetry();
    }
  }

  scheduleRetry() {
    if (this.retryCount >= 3) return;
    this.retryCount++;
    this.isRetrying = true;
    setTimeout(() => {
      this.setState({ error: null });
      this.isRetrying = false;
    }, 2000);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex flex-col items-center justify-center gap-3 p-8 text-center">
          <AlertTriangle className="h-8 w-8 text-destructive" />
          <p className="text-sm text-muted-foreground">
            The {this.props.name} section hit a snag.
          </p>
          {this.isRetrying ? (
            <div className="flex items-center gap-2">
              <div className="h-4 w-4 border-2 border-primary rounded-full animate-spin border-t-transparent" />
              <span className="text-xs text-muted-foreground">
                Retrying... ({this.retryCount} of 3)
              </span>
            </div>
          ) : (
            <Button size="sm" onClick={() => this.setState({ error: null })}>
              Retry
            </Button>
          )}
        </div>
      );
    }
    return this.props.children;
  }
}


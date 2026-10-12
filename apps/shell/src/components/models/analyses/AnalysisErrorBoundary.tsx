import { Component, type ReactNode } from 'react';
import { Alert } from '@basis/design-system';

interface AnalysisErrorBoundaryProps {
  name: string;
  /** Any change here clears a caught error and retries — pass whatever a fix would flow through
   *  (schema, model, evaluation), so remapping a line or editing an input recovers on its own. */
  resetKeys: unknown[];
  children: ReactNode;
}

interface AnalysisErrorBoundaryState {
  error: Error | null;
  resetKeys: unknown[];
}

/** Contains a crash to the one analysis that threw. Without it, a throw anywhere in an analysis
 *  panel unmounts the whole app and the screen goes blank. */
export class AnalysisErrorBoundary extends Component<AnalysisErrorBoundaryProps, AnalysisErrorBoundaryState> {
  state: AnalysisErrorBoundaryState = { error: null, resetKeys: this.props.resetKeys };

  static getDerivedStateFromError(error: Error): Partial<AnalysisErrorBoundaryState> {
    return { error };
  }

  static getDerivedStateFromProps(props: AnalysisErrorBoundaryProps, state: AnalysisErrorBoundaryState): Partial<AnalysisErrorBoundaryState> | null {
    const changed = props.resetKeys.length !== state.resetKeys.length || props.resetKeys.some((k, i) => k !== state.resetKeys[i]);
    return changed ? { error: null, resetKeys: props.resetKeys } : null;
  }

  componentDidCatch(error: Error) {
    console.error(`${this.props.name} analysis failed to render`, error);
  }

  render() {
    if (this.state.error) {
      return (
        <Alert tone="negative" title={`${this.props.name} couldn't render`}>
          {this.state.error.message}
        </Alert>
      );
    }
    return this.props.children;
  }
}

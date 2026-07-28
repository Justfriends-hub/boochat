import React from "react";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

type Props = React.PropsWithChildren<{
  className?: string;
}>;

export function SettingsGroup({ children, className }: Props) {
  const childrenArray = React.Children.toArray(children).filter(Boolean);
  return (
    <Card className={className + " overflow-hidden p-0"}>
      {childrenArray.map((child, idx) => (
        <div key={idx}>
          <div>{child}</div>
          {idx < childrenArray.length - 1 && (
            <div className="px-4">
              <Separator className="ml-[56px]" />
            </div>
          )}
        </div>
      ))}
    </Card>
  );
}

export default SettingsGroup;

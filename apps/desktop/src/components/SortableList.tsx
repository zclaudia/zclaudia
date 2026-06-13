import { useState, useRef, useCallback, type ReactNode } from 'react';
import {
  DndContext,
  closestCorners,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
  type DragOverEvent,
  type DragEndEvent,
  type DragStartEvent,
  DragOverlay,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';
import { CSS } from '@dnd-kit/utilities';

interface SortableItemProps {
  id: string;
  children: ReactNode;
  dragHandleClassName?: string;
  wrapperClassName?: string;
}

/**
 * Wraps a single draggable item. The whole row is the drag activator: a drag
 * only begins once the pointer moves past the sensor's distance threshold, so a
 * plain click still falls through to the item's own handler (e.g. select).
 */
export function SortableItem({ id, children, wrapperClassName }: SortableItemProps) {
  const {
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    position: 'relative' as const,
    zIndex: isDragging ? 1 : undefined,
  };

  return (
    <li ref={setNodeRef} style={style}>
      <div {...listeners} className={`flex select-none ${wrapperClassName ?? 'items-center'}`}>
        <div className="flex-1 min-w-0">{children}</div>
      </div>
    </li>
  );
}

interface SortableListProps {
  items: string[];
  onReorder: (orderedIds: string[]) => void;
  children: ReactNode;
  className?: string;
  dragHandleClassName?: string;
  renderOverlay?: (activeId: string) => ReactNode;
}

/**
 * Generic sortable list wrapper.
 * Wrap your list items with `<SortableItem id={...}>` inside this component.
 */
export function SortableList({
  items,
  onReorder,
  children,
  className,
  renderOverlay,
}: SortableListProps) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const lastOverIdRef = useRef<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(String(event.active.id));
    lastOverIdRef.current = null;
  }, []);

  const handleDragOver = useCallback((event: DragOverEvent) => {
    if (!event.over) return;
    const overId = String(event.over.id);
    if (overId !== String(event.active.id)) {
      lastOverIdRef.current = overId;
    }
  }, []);

  const collisionDetection = useCallback((args: Parameters<typeof pointerWithin>[0]) => {
    // Prefer the item directly under the pointer. This makes upward reordering
    // in compact lists much more reliable than center-based matching alone.
    const pointerCollisions = pointerWithin(args).filter(
      (collision) => String(collision.id) !== String(args.active.id)
    );
    if (pointerCollisions.length > 0) {
      return pointerCollisions;
    }

    return closestCorners(args).filter(
      (collision) => String(collision.id) !== String(args.active.id)
    );
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveId(null);
      const { active, over } = event;
      const overId = over ? String(over.id) : lastOverIdRef.current;
      lastOverIdRef.current = null;
      if (!overId || String(active.id) === overId) return;

      const oldIndex = items.indexOf(String(active.id));
      const newIndex = items.indexOf(overId);
      if (oldIndex === -1 || newIndex === -1) return;

      onReorder(arrayMove(items, oldIndex, newIndex));
    },
    [items, onReorder]
  );

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      modifiers={[restrictToVerticalAxis]}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActiveId(null)}
    >
      <SortableContext items={items} strategy={verticalListSortingStrategy}>
        <ul className={className}>{children}</ul>
      </SortableContext>
      <DragOverlay>
        {activeId && renderOverlay ? renderOverlay(activeId) : null}
      </DragOverlay>
    </DndContext>
  );
}

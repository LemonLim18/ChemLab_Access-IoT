
import React from 'react';
import { Trash2, Edit2, AlertCircle } from 'lucide-react';
import type { FridgeItem } from '../types';
import { FreshnessStatus } from '../types';
import { getCategoryIcon } from '../src/utils/iconUtils';

interface SlotCardProps {
  item: FridgeItem;
  onEdit: (item: FridgeItem) => void;
  onRemove: (id: string) => void;
}



const SlotCard: React.FC<SlotCardProps> = ({ item, onEdit, onRemove }) => {
  const getStatusColor = (status: FreshnessStatus) => {
    switch (status) {
      case FreshnessStatus.GOOD: return 'badge-success';
      case FreshnessStatus.NEAR_EXPIRY: return 'badge-warning';
      case FreshnessStatus.EXPIRED:
      case FreshnessStatus.SPOILED: return 'badge-error';
      default: return 'badge-ghost';
    }
  };

  const isLow = item.quantity <= item.reorderThreshold;

  return (
    <div className={`flex items-center gap-4 p-4 bg-base-100 border-b border-base-200 hover:bg-base-200/30 transition-colors first:rounded-t-2xl last:rounded-b-2xl last:border-b-0`}>
      {/* Icon Representation */}
      <div className={`w-12 h-12 rounded-xl flex items-center justify-center bg-base-200/50 shrink-0 ${isLow ? 'ring-2 ring-error/20' : ''}`}>
        {getCategoryIcon(item.category)}
      </div>

      {/* Main Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-2">
          <h3 className="font-bold text-sm truncate capitalize">{item.name}</h3>
          <span className={`badge badge-xs ${getStatusColor(item.status)}`}>{item.status}</span>
          {isLow && (
            <span className="text-error animate-pulse">
              <AlertCircle size={14} />
            </span>
          )}
        </div>

        <div className="flex-1 h-2 bg-base-200 rounded-full overflow-hidden mb-1">
          <div
            className={`h-full rounded-full transition-all duration-500 ${isLow ? 'bg-error' : 'bg-primary'}`}
            style={{ width: `${Math.min(100, (item.quantity / (item.reorderThreshold || 1)) * 100)}%` }}
          />
        </div>

        <div className="flex justify-between items-center px-0.5">
          <div className="flex items-center gap-1 opacity-40 text-[9px] font-black uppercase tracking-tighter">
            <span>Threshold</span>
            <span className="badge badge-ghost badge-xs h-3 text-[8px] px-1 font-black">{item.reorderThreshold}</span>
          </div>
          <div className="flex items-baseline gap-1">
            <span className={`text-xl font-black tabular-nums transition-colors ${isLow ? 'text-error' : 'text-primary'}`}>
              {item.quantity}
            </span>
            <span className="text-[10px] opacity-30 font-bold">/ {item.reorderThreshold}</span>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 shrink-0 ml-4">
        <button
          onClick={() => onEdit(item)}
          className="btn btn-ghost btn-sm btn-square"
          aria-label="Edit item"
        >
          <Edit2 size={14} />
        </button>
        <button
          onClick={() => onRemove(item.id)}
          className="btn btn-ghost btn-sm btn-square text-error"
          aria-label="Remove item"
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
};

export default SlotCard;

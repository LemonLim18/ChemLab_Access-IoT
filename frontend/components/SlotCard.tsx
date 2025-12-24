
import React from 'react';
import { Trash2, Edit2, AlertCircle, Package, Carrot, Milk, Apple, Beef, CupSoda, Utensils } from 'lucide-react';
import type { FridgeItem } from '../types';
import { FreshnessStatus } from '../types';

interface SlotCardProps {
  item: FridgeItem;
  onEdit: (item: FridgeItem) => void;
  onRemove: (id: string) => void;
}

const getCategoryIcon = (category: string) => {
  const size = 20;
  switch (category.toLowerCase()) {
    case 'dairy': return <Milk size={size} className="text-blue-500" />;
    case 'vegetables': return <Carrot size={size} className="text-orange-500" />;
    case 'fruits': return <Apple size={size} className="text-red-500" />;
    case 'meat': return <Beef size={size} className="text-red-700" />;
    case 'beverages': return <CupSoda size={size} className="text-cyan-500" />;
    default: return <Utensils size={size} className="text-gray-400" />;
  }
};

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
        <div className="flex items-center gap-2">
          <h3 className="font-bold text-sm truncate">{item.name}</h3>
          <span className={`badge badge-xs ${getStatusColor(item.status)}`}>{item.status}</span>
          {isLow && (
            <span className="text-error animate-pulse">
              <AlertCircle size={14} />
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 mt-1">
          <div className="flex-1 h-1.5 bg-base-200 rounded-full overflow-hidden">
            <div 
              className={`h-full rounded-full ${isLow ? 'bg-error' : 'bg-primary'}`} 
              style={{ width: `${Math.min(100, item.unit === 'percent' ? item.quantity : (item.quantity / (item.reorderThreshold * 5)) * 100)}%` }}
            />
          </div>
          <span className={`text-[10px] font-medium w-10 text-right ${isLow ? 'text-error font-bold' : 'opacity-60'}`}>
            {item.quantity}{item.unit === 'percent' ? '%' : ''}
          </span>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 shrink-0">
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

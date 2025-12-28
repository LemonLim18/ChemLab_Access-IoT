

import { Milk, Carrot, Apple, Beef, CupSoda, Utensils } from 'lucide-react';

export const getCategoryIcon = (category: string) => {
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

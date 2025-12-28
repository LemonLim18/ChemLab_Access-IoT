import React, { useState, useEffect } from 'react';
import { ChefHat, Send, Sparkles, Activity, ArrowLeft, ShoppingCart, Clock, BookOpen, Check, Star, Trash2 } from 'lucide-react';
import Swal from 'sweetalert2';
import type { FridgeItem, Recipe } from '../types';
import { getRecipeSuggestions, getRecipeDetails } from '../services/geminiService';
import { getCategoryIcon } from '../src/utils/iconUtils';

interface ChefAIViewProps {
    inventory: FridgeItem[];
    setInventory: React.Dispatch<React.SetStateAction<FridgeItem[]>>;
    onAddNotification: (notification: any) => void;
    expiringItems: FridgeItem[];
}

const ChefAIView: React.FC<ChefAIViewProps> = ({ inventory, setInventory, onAddNotification, expiringItems }) => {
    const [chefPrompt, setChefPrompt] = useState('');
    const [recipes, setRecipes] = useState<Recipe[]>([]);
    const [savedRecipes, setSavedRecipes] = useState<Recipe[]>([]);
    const [viewMode, setViewMode] = useState<'suggestions' | 'saved'>('suggestions');
    const [selectedRecipe, setSelectedRecipe] = useState<Recipe | null>(null);
    const [isLoadingRecipes, setIsLoadingRecipes] = useState(false);
    const [isLoadingDetails, setIsLoadingDetails] = useState(false);

    useEffect(() => {
        fetchSavedRecipes();
    }, []);

    const fetchSavedRecipes = async () => {
        try {
            const response = await fetch('http://localhost:8000/api/recipes/saved');
            if (response.ok) {
                const data = await response.json();
                setSavedRecipes(data);
            }
        } catch (error) {
            console.error('Failed to fetch saved recipes:', error);
        }
    };

    const handleSaveRecipe = async (recipe: Recipe) => {
        try {
            // First, ensure we have full details before saving
            let recipeToSave = { ...recipe };
            if (!recipe.fullIngredients || !recipe.instructions) {
                setIsLoadingDetails(true);
                const details = await getRecipeDetails(recipe.name, inventory);
                recipeToSave = { ...recipe, ...details };
                setIsLoadingDetails(false);
            }

            const response = await fetch('http://localhost:8000/api/recipes/save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(recipeToSave)
            });

            if (response.ok) {
                Swal.fire({
                    title: 'Saved!',
                    text: 'Recipe added to your favorites.',
                    icon: 'success',
                    timer: 1500,
                    showConfirmButton: false,
                    customClass: { popup: 'rounded-2xl border border-base-content/10 shadow-xl' }
                });
                fetchSavedRecipes();
            }
        } catch (error) {
            console.error('Failed to save recipe:', error);
            setIsLoadingDetails(false);
        }
    };

    const handleDeleteSavedRecipe = async (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        const result = await Swal.fire({
            title: 'Unsave Recipe?',
            text: "Are you sure you want to remove this from your favorites?",
            icon: 'warning',
            showCancelButton: true,
            confirmButtonText: 'Yes, remove it',
            cancelButtonText: 'Cancel',
            customClass: {
                popup: 'rounded-2xl border border-base-content/10 shadow-2xl',
                confirmButton: 'btn btn-error text-white mx-2',
                cancelButton: 'btn btn-ghost mx-2'
            },
            buttonsStyling: false
        });

        if (result.isConfirmed) {
            try {
                const response = await fetch(`http://localhost:8000/api/recipes/saved/${id}`, {
                    method: 'DELETE'
                });
                if (response.ok) {
                    setSavedRecipes(prev => prev.filter(r => r.id !== id));
                    Swal.fire({
                        title: 'Removed',
                        icon: 'success',
                        timer: 1000,
                        showConfirmButton: false,
                        customClass: { popup: 'rounded-2xl border border-base-content/10 shadow-xl' }
                    });
                }
            } catch (error) {
                console.error('Failed to delete recipe:', error);
            }
        }
    };

    const handleFetchRecipes = async (forcedPrompt?: string) => {
        const promptToUse = forcedPrompt || chefPrompt;
        if (!promptToUse.trim()) return;

        setIsLoadingRecipes(true);
        setSelectedRecipe(null);
        try {
            const suggestions = await getRecipeSuggestions(inventory, promptToUse);
            const recipesWithImages = suggestions.map(r => ({
                ...r,
                imageUrl: `https://image.pollinations.ai/prompt/${encodeURIComponent(r.name + ' professional food photography, gourmet plating, high resolution, delicious')}`
            }));
            setRecipes(recipesWithImages);
        } catch (error) {
            console.error('Failed to fetch recipes:', error);
            Swal.fire({
                title: 'Error',
                text: 'Failed to fetch recipe suggestions. Please try again.',
                icon: 'error',
                customClass: {
                    popup: 'rounded-2xl border border-base-content/10 shadow-2xl',
                    confirmButton: 'btn btn-primary text-white'
                },
                buttonsStyling: false
            });
        } finally {
            setIsLoadingRecipes(false);
        }
    };

    const handleOpenCookbook = async (recipe: Recipe) => {
        if (recipe.instructions && recipe.fullIngredients) {
            setSelectedRecipe(recipe);
            return;
        }

        setIsLoadingDetails(true);
        try {
            const details = await getRecipeDetails(recipe.name, inventory);
            setSelectedRecipe({ ...recipe, ...details });
        } catch (error) {
            console.error('Failed to fetch recipe details:', error);
            Swal.fire({
                title: 'Error',
                text: 'Failed to fetch cookbook details. Please try again.',
                icon: 'error',
                customClass: {
                    popup: 'rounded-2xl border border-base-content/10 shadow-2xl',
                    confirmButton: 'btn btn-primary text-white'
                },
                buttonsStyling: false
            });
        } finally {
            setIsLoadingDetails(false);
        }
    };

    const handleFinishCooking = () => {
        if (!selectedRecipe) return;

        setInventory(prev => prev.map(item => {
            const isUsed = selectedRecipe.fullIngredients?.some(ing =>
                ing.toLowerCase().includes(item.name.toLowerCase())
            );
            if (isUsed) {
                return { ...item, quantity: Math.max(0, item.quantity - 30) };
            }
            return item;
        }));

        onAddNotification({
            id: Date.now().toString(),
            title: 'Meal Cooked!',
            message: `Inventory updated after preparing ${selectedRecipe.name}.`,
            type: 'success',
            timestamp: new Date().toISOString(),
            isRead: false
        });

        setSelectedRecipe(null);
        Swal.fire({
            title: 'Meal Prepared!',
            text: 'Inventory levels updated automatically.',
            icon: 'success',
            confirmButtonText: 'Great!',
            customClass: {
                popup: 'rounded-2xl border border-base-content/10 shadow-2xl',
                confirmButton: 'btn btn-success text-white'
            },
            buttonsStyling: false
        });
    };

    const renderTextWithBold = (text: string) => {
        if (!text) return text;
        const parts = text.split(/(\*\*.*?\*\*)/g);
        return parts.map((part, i) => {
            if (part.startsWith('**') && part.endsWith('**')) {
                return <strong key={i} className="font-black text-primary">{part.slice(2, -2)}</strong>;
            }
            return part;
        });
    };

    return (
        <div className="max-w-4xl mx-auto space-y-6 pb-10">
            {selectedRecipe ? (
                <div className="card bg-base-100 shadow-2xl border border-base-200 animate-in zoom-in duration-300">
                    <div className="card-body p-4 sm:p-8">
                        <button className="btn btn-sm btn-ghost gap-2 mb-4" onClick={() => setSelectedRecipe(null)}>
                            <ArrowLeft size={16} /> Back
                        </button>
                        <div className="flex flex-col md:flex-row gap-10">
                            <div className="w-full md:w-1/3">
                                <div className="aspect-square bg-base-200 rounded-3xl flex items-center justify-center mb-4 overflow-hidden shadow-inner border border-base-content/5">
                                    {selectedRecipe.imageUrl ? (
                                        <img src={selectedRecipe.imageUrl} alt={selectedRecipe.name} className="w-full h-full object-cover animate-in fade-in duration-500" />
                                    ) : (
                                        <ChefHat size={80} className="text-primary opacity-20" />
                                    )}
                                </div>
                                <div className="flex flex-col gap-2 p-4 bg-base-200/50 rounded-2xl border border-base-content/5">
                                    <h4 className="font-bold flex items-center gap-2 text-primary">
                                        <ShoppingCart size={18} /> Ingredients
                                    </h4>
                                    <ul className="text-sm space-y-2 mt-2">
                                        {selectedRecipe.fullIngredients?.map((ing, i) => (
                                            <li key={i} className="flex gap-2 items-start">
                                                <input type="checkbox" className="checkbox checkbox-xs checkbox-primary mt-1" defaultChecked />
                                                <span className="text-xs">{renderTextWithBold(ing)}</span>
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            </div>
                            <div className="flex-1">
                                <div className="flex justify-between items-start">
                                    <div>
                                        <h2 className="text-3xl font-black mb-1">{selectedRecipe.name}</h2>
                                        <p className="opacity-60 text-sm">{selectedRecipe.description}</p>
                                    </div>
                                    <div className="badge badge-primary">{selectedRecipe.difficulty}</div>
                                </div>
                                <div className="flex gap-4 my-6 text-sm font-semibold opacity-70">
                                    <div className="flex items-center gap-2"><Clock size={16} /> {selectedRecipe.cookTime}</div>
                                    <div className="flex items-center gap-2"><BookOpen size={16} /> Cookbook Details</div>
                                </div>
                                <div className="space-y-6">
                                    <h4 className="font-bold text-xl flex items-center gap-2">
                                        <Sparkles size={20} className="text-warning" /> Instructions
                                    </h4>
                                    <div className="space-y-4">
                                        {selectedRecipe.instructions?.map((step, i) => (
                                            <div key={i} className="flex gap-4">
                                                <div className="w-8 h-8 rounded-full bg-primary text-primary-content flex items-center justify-center font-bold shrink-0 shadow-md">
                                                    {i + 1}
                                                </div>
                                                <p className="text-sm pt-1 leading-relaxed opacity-80">{renderTextWithBold(step)}</p>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                                <button className="btn btn-primary btn-block mt-10 shadow-lg" onClick={handleFinishCooking}>
                                    <Check size={20} /> Finish Cooking & Update Stocks
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            ) : (
                <div className="space-y-6">
                    <div className="card bg-base-100 shadow-xl border border-base-200 p-8 text-center bg-gradient-to-b from-base-100 to-base-200/30">
                        <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-6 text-primary animate-bounce">
                            <ChefHat size={40} />
                        </div>
                        <h2 className="text-4xl font-black mb-2 tracking-tight">Chef AI</h2>
                        <p className="opacity-50 text-xs font-bold uppercase tracking-[0.2em] mb-8 text-primary">Your Personal Culinary Assistant</p>

                        <div className="flex justify-center mb-8">
                            <div className="tabs tabs-boxed bg-base-200 p-1 rounded-2xl shadow-inner border border-base-content/5">
                                <button
                                    className={`tab tab-md rounded-xl font-bold transition-all px-6 ${viewMode === 'suggestions' ? 'tab-active !bg-primary !text-white shadow-lg' : 'opacity-50 hover:opacity-100'}`}
                                    onClick={() => setViewMode('suggestions')}
                                >
                                    <Sparkles size={16} className="mr-2" /> AI Suggestions
                                </button>
                                <button
                                    className={`tab tab-md rounded-xl font-bold transition-all px-6 ${viewMode === 'saved' ? 'tab-active !bg-primary !text-white shadow-lg' : 'opacity-50 hover:opacity-100'}`}
                                    onClick={() => setViewMode('saved')}
                                >
                                    <Star size={16} className="mr-2" /> Saved Recipes ({savedRecipes.length})
                                </button>
                            </div>
                        </div>

                        {viewMode === 'suggestions' && (
                            <div className="join w-full max-w-xl mx-auto shadow-2xl rounded-full overflow-hidden border-4 border-primary/20 bg-base-100 p-1 group focus-within:border-primary/40 transition-all">
                                <input
                                    type="text"
                                    placeholder="What's cooking today?"
                                    className="input join-item w-full bg-transparent border-none rounded-full focus:outline-none px-6 font-bold"
                                    value={chefPrompt}
                                    onChange={(e) => setChefPrompt(e.target.value)}
                                    onKeyPress={(e) => e.key === 'Enter' && handleFetchRecipes()}
                                />
                                <button
                                    className="btn btn-primary join-item px-8 rounded-full shadow-lg"
                                    onClick={() => handleFetchRecipes()}
                                    disabled={isLoadingRecipes}
                                >
                                    {isLoadingRecipes ? (
                                        <span className="loading loading-spinner loading-sm"></span>
                                    ) : (
                                        <Send size={20} />
                                    )}
                                </button>
                            </div>
                        )}
                    </div>

                    {viewMode === 'suggestions' ? (
                        <div className="space-y-8">
                            {recipes.length === 0 && !isLoadingRecipes && (
                                <>
                                    <div className="animate-in fade-in slide-in-from-bottom-4 duration-700 delay-150">
                                        <div className="flex items-center gap-2 px-2 mb-4">
                                            <Sparkles size={16} className="text-warning" />
                                            <h3 className="text-xs font-black uppercase tracking-widest opacity-40">Quick Inspiration</h3>
                                        </div>
                                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                            {[
                                                { label: 'Japanese', icon: '🍕', prompt: 'Japanese style healthy' },
                                                { label: 'Asian', icon: '🍜', prompt: 'Malaysia style healthy' },
                                                { label: 'Healthy', icon: '🥗', prompt: 'High protein salad' },
                                                { label: 'Quick', icon: '⏱️', prompt: '15 minute snack' }
                                            ].map((item, idx) => (
                                                <button
                                                    key={idx}
                                                    onClick={() => {
                                                        setChefPrompt(item.prompt);
                                                        setTimeout(() => handleFetchRecipes(item.prompt), 100);
                                                    }}
                                                    className="card bg-base-100 border border-base-200 p-4 hover:border-primary hover:shadow-xl transition-all group text-left shadow-sm"
                                                >
                                                    <span className="text-2xl mb-2 block group-hover:scale-125 transition-transform origin-left">{item.icon}</span>
                                                    <span className="font-bold text-sm block">{item.label}</span>
                                                    <span className="text-[10px] opacity-40 font-bold uppercase tracking-tighter">Try this prompt</span>
                                                </button>
                                            ))}
                                        </div>
                                    </div>

                                    {expiringItems.length > 0 && (
                                        <div className="animate-in fade-in slide-in-from-bottom-6 duration-1000 delay-300">
                                            <div className="flex items-center gap-2 px-2 mb-4">
                                                <Activity size={16} className="text-error" />
                                                <h3 className="text-xs font-black uppercase tracking-widest opacity-40">Chef's Advice</h3>
                                            </div>
                                            <div className="card bg-error/5 border border-error/10 p-6 flex flex-row items-center gap-6 shadow-sm">
                                                <div className="flex -space-x-3">
                                                    {expiringItems.slice(0, 3).map((item, i) => (
                                                        <div key={i} className="w-12 h-12 rounded-full bg-base-100 border-2 border-error/20 flex items-center justify-center text-xl shadow-lg">
                                                            {getCategoryIcon(item.category)}
                                                        </div>
                                                    ))}
                                                </div>
                                                <div className="flex-1 text-left">
                                                    <h4 className="font-bold text-base leading-tight">Your {expiringItems[0].name} {expiringItems.length > 1 ? `and ${expiringItems.length - 1} other items` : ''} should be used soon.</h4>
                                                    <p className="text-xs opacity-60">Minimize waste with a custom recipe.</p>
                                                </div>
                                                <button
                                                    onClick={() => {
                                                        const prompt = `Make something with ${expiringItems.map(i => i.name).join(', ')}`;
                                                        setChefPrompt(prompt);
                                                        setTimeout(() => handleFetchRecipes(prompt), 100);
                                                    }}
                                                    className="btn btn-sm btn-error text-white font-black shadow-md"
                                                >
                                                    Plan Meal
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </>
                            )}

                            {recipes.length > 0 && !isLoadingRecipes && (
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-6">
                                    {recipes.map((recipe, idx) => (
                                        <div key={idx} className="card bg-base-100 shadow-md border border-base-200 hover:border-primary transition-all overflow-hidden group">
                                            <figure className="aspect-video overflow-hidden border-b border-base-200">
                                                <img
                                                    src={recipe.imageUrl}
                                                    alt={recipe.name}
                                                    className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
                                                />
                                            </figure>
                                            <div className="p-4">
                                                <h3 className="font-bold text-base mb-1 truncate">{recipe.name}</h3>
                                                <p className="text-xs opacity-60 line-clamp-2 mb-3 h-8">{recipe.description}</p>
                                                <div className="flex justify-between items-center">
                                                    <span className="text-[10px] font-bold opacity-30 uppercase tracking-widest">{recipe.cookTime} • {recipe.difficulty}</span>
                                                    <div className="flex gap-1">
                                                        <button
                                                            className={`btn btn-xs btn-ghost btn-circle ${savedRecipes.some(sr => sr.name === recipe.name) ? 'text-primary' : 'opacity-40 hover:opacity-100'}`}
                                                            onClick={(e) => { e.stopPropagation(); handleSaveRecipe(recipe); }}
                                                            title="Save to Favorites"
                                                        >
                                                            <Star size={14} fill={savedRecipes.some(sr => sr.name === recipe.name) ? "currentColor" : "none"} />
                                                        </button>
                                                        <button className="btn btn-xs btn-primary gap-1 shadow-sm" onClick={() => handleOpenCookbook(recipe)}>
                                                            <BookOpen size={12} /> Cookbook
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="space-y-6">
                            {savedRecipes.length === 0 ? (
                                <div className="text-center py-20 bg-base-200/50 rounded-3xl border-2 border-dashed border-base-content/10">
                                    <Star size={48} className="mx-auto mb-4 text-primary opacity-20" />
                                    <p className="font-bold opacity-40">Your favorite recipes will appear here.</p>
                                    <button className="btn btn-sm btn-outline btn-primary mt-4" onClick={() => setViewMode('suggestions')}>
                                        Browse AI Suggestions
                                    </button>
                                </div>
                            ) : (
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                                    {savedRecipes.map((recipe, idx) => (
                                        <div key={idx} className="card bg-base-100 shadow-md border border-base-200 hover:border-primary transition-all overflow-hidden group cursor-pointer" onClick={() => handleOpenCookbook(recipe)}>
                                            <figure className="aspect-video overflow-hidden relative border-b border-base-200">
                                                <img
                                                    src={recipe.imageUrl}
                                                    alt={recipe.name}
                                                    className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
                                                />
                                                <button
                                                    className="absolute top-2 right-2 btn btn-xs btn-circle btn-error text-white opacity-0 group-hover:opacity-100 transition-opacity shadow-lg"
                                                    onClick={(e) => handleDeleteSavedRecipe(recipe.id!, e)}
                                                    title="Remove from Saved"
                                                >
                                                    <Trash2 size={12} />
                                                </button>
                                            </figure>
                                            <div className="p-4">
                                                <h3 className="font-bold text-base mb-1 truncate">{recipe.name}</h3>
                                                <p className="text-xs opacity-60 line-clamp-2 mb-3 h-8">{recipe.description}</p>
                                                <div className="flex justify-between items-center">
                                                    <span className="text-[10px] font-bold opacity-30 uppercase tracking-widest">{recipe.cookTime} • {recipe.difficulty}</span>
                                                    <button className="btn btn-xs btn-primary gap-1 shadow-sm">
                                                        <BookOpen size={12} /> Cook Now
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}

            {isLoadingDetails && (
                <div className="fixed inset-0 z-50 bg-base-100/90 backdrop-blur-sm flex flex-col items-center justify-center p-6 text-center animate-in fade-in duration-300">
                    <div className="flex flex-col items-center bg-base-100 p-10 rounded-3xl shadow-2xl border border-base-content/10">
                        <BookOpen size={48} className="text-primary animate-bounce mb-4" />
                        <h3 className="text-xl font-black">Chef AI is thinking...</h3>
                        <p className="text-sm opacity-50 mt-2 font-medium">Gathering ingredients and instructions from Gemini...</p>
                        <div className="w-48 h-1.5 bg-base-200 rounded-full mt-6 overflow-hidden">
                            <div className="h-full bg-primary animate-progress origin-left"></div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ChefAIView;

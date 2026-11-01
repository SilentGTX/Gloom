// The pets you created (main/pets.ts), for Settings › Pets: read once, then kept
// current as their folder changes (a Create Pet session finishing one, say).
import { useEffect } from 'react'
import { create } from 'zustand'
import type { CustomPet } from '@shared/ipc'

export const useCustomPets = create<{ pets: CustomPet[]; loaded: boolean }>(() => ({ pets: [], loaded: false }))

let started = false

/** Starts listening, once; returns the pets. */
export function useCustomPetList(): CustomPet[] {
  useEffect(() => {
    const api = window.gloom?.pets
    if (started || !api) return
    started = true
    void api.list().then((pets) => useCustomPets.setState({ pets, loaded: true }))
    api.onChanged((pets) => useCustomPets.setState({ pets, loaded: true }))
  }, [])
  return useCustomPets((s) => s.pets)
}

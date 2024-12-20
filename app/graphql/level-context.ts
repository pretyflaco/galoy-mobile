import { createContext, useContext } from "react"

export const AccountLevel = {
  NonAuth: "NonAuth",
  Zero: "ZERO",
  One: "ONE",
  Two: "TWO",
  Three: "THREE",
} as const

export type AccountLevel = (typeof AccountLevel)[keyof typeof AccountLevel]

const Level = createContext<{
  isAtLeastLevelZero: boolean
  isAtLeastLevelOne: boolean
  isAtLeastLevelTwo: boolean
  isAtLeastLevelThree: boolean
  currentLevel: AccountLevel
}>({
  isAtLeastLevelZero: false,
  isAtLeastLevelOne: false,
  isAtLeastLevelTwo: false,
  isAtLeastLevelThree: false,
  currentLevel: AccountLevel.NonAuth,
})

export const LevelContextProvider = Level.Provider

export const useLevel = () => useContext(Level)
